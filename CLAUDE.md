# STHENOVA ERP — mapa del proyecto

ERP mexicano en producción con Elías Jabari como primer cliente. Backend FastAPI + Postgres, frontend React/Vite, deploy en Render (auto-deploy desde `main`).

## Stack

- **Backend**: FastAPI (async) + SQLAlchemy async + Pydantic v2 + Postgres (Supabase en prod)
- **Frontend**: React 18 + TypeScript + Vite 7 (bundle único, sin code-split)
- **Auth**: JWT con `python-jose`, roles (`admin`, `manager`, `user`) + permisos por módulo
- **PDFs**: ReportLab (recibos de nómina, contratos, cotizaciones)
- **Email**: **Resend** (dominio `sthenova.com` con DKIM verificado). Brevo fue reemplazado — bloqueaba envíos silenciosamente
- **Deploy**: Render — `render.yaml` en raíz. Backend Docker + frontend static. Auto-deploy en push a `main`
- **Dominio**: `sthenova.com` (GoDaddy DNS con MX/SPF/DKIM configurados)

## Rama de trabajo

**SIEMPRE trabajar en `claude/sthenova-erp-status-xnfaal`.** Cuando el PR anterior ya está mergeado, resetear desde `main`:
```
git fetch origin main && git checkout -B claude/sthenova-erp-status-xnfaal origin/main
```
Cada PR se mergea con `merge` (no squash). Render auto-deployará.

## Layout

```
backend/app/
  main.py              # FastAPI app + CORS + startup (create_all + migrations)
  core/                # config, logging, rate limit
  db/
    session.py         # engine async
    migrations.py      # ALTER TABLE IF NOT EXISTS idempotentes por módulo
  api/
    deps.py            # get_db, get_current_user, module_write_guard
    v1/api.py          # agregador — cada router bajo /api/v1/<module>
  modules/<mod>/
    models.py          # SQLAlchemy — Base.metadata.create_all crea tablas nuevas
    schemas.py         # Pydantic in/out
    router.py          # endpoints
    service.py         # lógica de negocio (nunca lógica en router)

frontend/src/
  App.tsx              # theme, tabs de módulos, router principal
  features/<mod>/      # <Mod>Module.tsx + api.ts (axios)
  services/api.ts      # axios base + interceptors JWT
  components/          # compartidos (TrianglesCanvas, etc.)
```

## Módulos (backend + frontend)

| Módulo | LoC backend | LoC frontend | Nota |
|---|---:|---:|---|
| retail | 4794 | 4700 | tiendas físicas + POS avanzado |
| hr | 2317 | 3692 | nómina LFT, contratos, liquidaciones, comunicación |
| sales | 1816 | 1193 | CRM, pipeline, cotizaciones, devoluciones |
| inventory | 1744 | 3895 | catálogo, stock, ingesta masiva, marketplaces |
| accounting | 1640 | 1663 | contabilidad electrónica SAT |
| finance | 1494 | 2103 | CxC/CxP, bancos, conciliación |
| forecast | 1127 | 1726 | pronóstico ventas |
| pos | 967 | 3073 | punto de venta |
| ingesta | 958 | — | plantillas de carga masiva |
| bi | — | 1920 | dashboards ejecutivos |

## Convenciones críticas

### Backend
- **Todo async**. `AsyncSession` en cada endpoint. Usar `.scalars().first()` / `.scalars().all()`.
- **Schemas Pydantic v2**: `model_config = ConfigDict(from_attributes=True)`, `model_dump(exclude_unset=True)` para PATCH.
- **Migraciones**: modelos nuevos entran vía `Base.metadata.create_all` en startup. **Nuevas columnas en tablas existentes DEBEN ir en `backend/app/db/migrations.py`** con `ALTER TABLE ... IF NOT EXISTS` — cada statement corre en su propia transacción y no rompe el arranque si falla.
- **Auditoría**: `_log_audit(db, user_id, action, description, details)` en cambios importantes.
- **`_require_manager(current_user)`** al inicio de endpoints que escriben.

### Frontend
- **Sin code splitting** — bundle único ~1.7MB gzip 409KB. Cada módulo es un solo archivo `<Mod>Module.tsx`.
- **Estilos inline** con objeto `t` (theme) pasado por props. Cero CSS-in-JS. `t.nova` (accent azul), `t.navy`, `t.good`, `t.bad`, `t.warn`, `t.panel`, `t.panel2`, `t.border`, `t.textHi/Mid/Lo`.
- **api.ts por módulo** — objeto con funciones que devuelven `.then(r => r.data)`. Blobs con `responseType: "blob"` y `downloadBlob(blob, filename)`.
- **Modales** con `createPortal(<div>, document.body)`.
- **TypeScript relajado** — mucho `any`, no pelear con tipos.

## Gotchas conocidos (no volver a caer)

- **Colisiones de nombres en HRModule.tsx**: existía `CONTRACT_TYPES` (Record del tipo de empleado) y agregué otro para plantillas de contrato → tuve que renombrar a `CONTRACT_TEMPLATES`. `tsc --noEmit` no detecta duplicados, `npm run build` (esbuild) sí. **Correr `npm run build` local antes de mergear cambios grandes en HRModule.**
- **Gauge SVG**: `large-arc-flag` siempre debe ser `0` en un semicírculo (max 180°). Con `1` se dibuja el arco largo (216°).
- **Order.balance @property** debe estar dentro de `class Order`, no de otras clases del mismo archivo — un mal indent tiraba pagos silenciosamente.
- **CORS + `allow_credentials=True`** no admite `allow_origins=["*"]`. La lista está hardcoded en `main.py`.
- **Email**: `MAIL_FROM` debe ser `STHENOVA <no-reply@sthenova.com>` (no gmail). Brevo → Resend fue el switch definitivo.
- **create_all no altera tablas** — para nuevas columnas usa migrations.py.
- **Employee `sbc`** es diario, no mensual. Existe `POST /hr/employees/fix-sbc` para auto-corregir capturas viejas.

## Mapeo del módulo Retail (referencia formal)

**Flujos físicos de mercancía:**

1. **Sell-in** — mercancía que tú vendes/facturas al customer de la cadena.
   Se registra vía `Orders` en el módulo Sales (con `customer_id` = customer
   vinculado a la cadena vía `RetailChannel.customer_id`). Sale de tu almacén
   central (`Warehouse.type=own`) y entra al almacén de consignación de la
   tienda (`RetailStore.consignment_warehouse_id`).

2. **Sell-out** — la cadena reporta lo que vendió al consumidor final por
   (tienda × SKU × periodo). Se guarda en `SellOutReport`. Cuando la tienda
   tiene `consignment_warehouse_id`, el sell-out descuenta stock físico del
   consignment (tracking en `SellOutReport.stock_consumed`).

3. **Traslados tienda↔tienda** — mueve stock de la consignación de una tienda
   a la de otra. Backend: `POST /retail/store-transfers`. Motor de sugerencias:
   `GET /retail/store-transfers/suggestions` (WoS diferencial con ventana de
   4 sem por defecto).

4. **Resurtido manual** — atajo desde Reabasto para mandar de un central a
   una tienda sin esperar sugerencia automática (modal `ManualResurtidoModal`).

5. **Devoluciones físicas** — tabla `retail_returns` con ciclo de vida:
   `pending → in_transit → received → cancelled`. Al recibir, se separa en:
     - `units_good` → entra al warehouse "Retornos · Buen estado" (vendible)
     - `units_damaged` → entra al warehouse "Merma · Devoluciones dañadas"
   Ambos warehouses se auto-crean al primer uso (`_ensure_returns_warehouse`).
   Cada recepción genera un `StockMovement` con reference `retail_return:{id}`.

**Métricas derivadas** (en `service.py`):

- **WoS (Weeks of Supply)** = on_hand ÷ velocity_semanal — ventana 4 sem.
- **Sell-through %** = sell_out / sell_in × 100 (rota lo que le mandas)
- **Return rate %** = devoluciones / venta bruta × 100
- **Fill rate %** = demanda satisfecha estimada (nivel de servicio)

**Umbrales por cadena** (política comercial editable en `RetailChannel`):
- `target_wos_weeks` (default 4) — meta operativa
- `critical_wos_weeks` (default 2) — dispara alerta rojo/reabasto urgente
- `overstock_wos_weeks` (default 12 → recomendado 8 para sugerencias) — dispara alerta amarilla
- `no_movement_days` (default 21) — sin ventas = alerta
- `return_rate_max_pct` (default 5) — umbral de tasa de devoluciones

**Auto-provisión de consignaciones**: `POST /retail/stores/{id}/ensure-consignment`
y también sucede transparentemente al ejecutar cualquier traslado si la
tienda destino no tiene consignation. Nunca falla el flujo por eso.

## Cumplimiento fiscal MX

- **ISR**: tabla mensual Anexo 8 RMF (en `hr/service.py`), se prorratea por frecuencia
- **IMSS**: cálculo obrero + patronal sobre SBC × días cotizados
- **INFONAVIT/FONACOT**: descuento configurable por empleado
- **Pensión alimenticia**: LFT art. 110-V, porcentaje/fija/UMA
- **Incapacidades**: subtipos `enfermedad_general | maternidad | riesgo_trabajo | paternidad` con reglas LSS 42/58/101
- **Liquidación**: `POST /hr/settlements/calculate` — LFT arts. 48, 50, 79-89, 162
- **Contratos**: 8 plantillas PDF (LFT + Cód. Comercio + Cód. Civil) en `hr/contracts_pdf.py`
- **CFDI**: recibos de nómina generados con ReportLab, listos para timbrar externamente
- **UMA 2026**: `113.14` diario, se lee desde `hr/service.py`
- **Kardex del empleado** (B1): `hr/kardex.py` — historial anual JSON + PDF firmado
- **Presupuesto de nómina** (B2): `hr/payroll_budgets.py` — matriz 12 meses × empleado + variance real vs budget
- **PTU** (B3): `hr/ptu.py` — arts. 122-131 LFT + reforma 2021 art. 127-VIII (mayor entre 3 meses salario o promedio 3 años), exclusiones art. 127-I/II/VI/VII, cédula PDF, genera nómina tipo `ptu`
- **Ajuste anual ISR** (B4): `hr/annual_isr.py` — arts. 97 y 116 LISR, tarifa anual = mensual×12, exclusiones art. 97-A/B, PDF constancia art. 99
- **Cédulas IMSS** (B5): `hr/imss_cedulas.py` — mensual (EGM/IV/GPS/RT) + bimestral (Retiro/CV/INFONAVIT 5% + amortizaciones), PDF/XLSX
- **Avisos IMSS** (B6): `hr/imss_avisos.py` — modelos AFIL-02/04/08, detección automática de pendientes con `overdue` (5 días hábiles), historial persistido en `IMSSMovement`
- **DIM Anexo 1** (B7): `hr/dim_export.py` — .txt CP-850 con RFC/CURP/nombre/ingresos/ISR para importar en programa DIM SAT
- **SUA export** (B8): `hr/sua_export.py` — MOVTOS.txt ancho-fijo con tipos SUA (08 alta / 02 baja / 07 modif salario) importable en SUA escritorio

## Campos empleado / empresa relacionados a fiscal MX

- `Employee.ptu_excluded` — art. 127-I/VI LFT (director/gerente/doméstico)
- `Employee.is_confidential` — cap art. 127-II (sindicato_max × 1.20)
- `Employee.declares_own_annual` — art. 97-B (empleado hace su propia declaración anual)
- `CompanyProfile.imss_registro_patronal` — se imprime en cédulas y avisos AFIL

## Comandos frecuentes

```bash
# Backend local
cd backend && uvicorn app.main:app --reload

# Frontend local
cd frontend && npm run dev

# Build (SIEMPRE antes de mergear cambios grandes en HRModule)
cd frontend && npm run build

# Type-check solo
cd frontend && npx tsc --noEmit
```

## Deploy

- Push a `main` → Render construye backend (docker) y frontend (vite build) en paralelo
- Backend health: `https://sthenova-backend.onrender.com/health`
- Frontend: `https://sthenova-frontend.onrender.com`
- Migraciones idempotentes corren en startup del backend

## Notas de estilo

- Comentarios en español, código en inglés.
- Nunca crear archivos `.md` de documentación fuera de este mapa a menos que el usuario lo pida.
- Nunca agregar emojis al código a menos que el usuario los pida.
- Los mensajes de commit del usuario suelen ser cortos ("adelante", "listo?", "haslo"). Interpretar por contexto reciente.
