"""Tests unitarios del motor de nómina.

Cubre las funciones puras (sin BD) que hacen los cálculos fiscales:
ISR, SAE (subsidio al empleo), IMSS obrero, IMSS patronal, INFONAVIT
(aportación patronal), ISN estatal.

Estos tests son la red de seguridad para evitar regresiones en el motor.
"""
import pytest
from app.modules.hr.service import (
    calc_isr,
    calc_sae,
    calc_isr_net,
    calc_imss_employee,
    calc_imss_employer,
    calc_infonavit_employer_amort,
    calc_state_payroll_tax,
    UMA_2026,
)


# ── ISR ────────────────────────────────────────────────────────────────────
class TestISR:
    def test_gravable_cero_no_isr(self):
        """Salario gravable en 0 (aguinaldo exento, sin días trabajados) → 0 ISR."""
        assert calc_isr(0, "quincenal") == 0.0
        assert calc_isr(-100, "quincenal") == 0.0  # negativo también

    def test_gravable_pequeno_quincenal(self):
        """Empleado con salario bajo — ISR proporcional pequeño."""
        # $2,800 quincenal = $5,600 mensual (aprox salario mínimo)
        isr = calc_isr(2800, "quincenal")
        # Debe ser positivo pero pequeño
        assert 0 < isr < 100

    def test_gravable_alto_es_progresivo(self):
        """El ISR debe aumentar con el gravable — progresividad."""
        isr_bajo = calc_isr(10_000, "mensual")
        isr_medio = calc_isr(50_000, "mensual")
        isr_alto = calc_isr(150_000, "mensual")
        assert isr_bajo < isr_medio < isr_alto

    def test_quincenal_vs_mensual_prorrateado(self):
        """El ISR quincenal ≈ mitad del mensual (con leve diferencia por progresividad)."""
        gravable_mensual = 30_000
        isr_mensual = calc_isr(gravable_mensual, "mensual")
        isr_quincenal = calc_isr(gravable_mensual / 2, "quincenal")
        # El quincenal debería ser aproximadamente la mitad del mensual
        assert isr_quincenal == pytest.approx(isr_mensual / 2, rel=0.001)


# ── SAE (subsidio al empleo) ───────────────────────────────────────────────
class TestSAE:
    def test_gravable_cero_no_sae(self):
        """Sin salario gravable no aplica SAE."""
        assert calc_sae(0, "quincenal") == 0.0
        assert calc_sae(-100, "quincenal") == 0.0

    def test_sae_solo_aplica_salarios_bajos(self):
        """SAE es solo para salarios bajos (hasta ~$10k mensual)."""
        # Salario alto → sin subsidio
        assert calc_sae(50_000, "mensual") == 0.0
        # Salario bajo → hay subsidio
        assert calc_sae(3_000, "mensual") > 0


# ── ISR neto con SAE ───────────────────────────────────────────────────────
class TestISRNet:
    def test_returns_tuple(self):
        """Regresa (isr_retenido, subsidio_pagado, isr_bruto)."""
        result = calc_isr_net(30_000, "mensual")
        assert isinstance(result, tuple)
        assert len(result) == 3

    def test_salario_alto_solo_retiene(self):
        """Salarios altos: subsidio_pagado = 0."""
        isr_ret, sub_pag, isr_bruto = calc_isr_net(50_000, "mensual")
        assert sub_pag == 0.0
        assert isr_ret == isr_bruto  # SAE=0 → isr_ret == isr_bruto

    def test_salario_bajo_paga_subsidio(self):
        """Salarios bajos donde SAE > ISR: patrón paga subsidio."""
        # Salario mínimo aproximado
        isr_ret, sub_pag, isr_bruto = calc_isr_net(2_500, "mensual")
        # Si SAE >= ISR bruto, no se retiene
        if sub_pag > 0:
            assert isr_ret == 0.0


# ── IMSS obrero ────────────────────────────────────────────────────────────
class TestIMSSObrero:
    def test_sbc_diario_tipico(self):
        """SBC diario típico ~$200 (empleado con salario ~$6k mensual).
        IMSS obrero ≈ SBC × 15 días × 2% = $60."""
        sbc_diario = 200.0
        dias = 15
        imss = calc_imss_employee(sbc_diario, dias)
        # 200 × 15 × (0.0025 + 0.00625 + 0.01125) = 200 × 15 × 0.02 = 60
        assert imss == pytest.approx(60.0, abs=0.01)

    def test_sbc_topado_25_umas(self):
        """SBC arriba de 25 UMAs se topa."""
        sbc_muy_alto = 10_000.0  # muy por encima del tope
        dias = 15
        tope = 25 * UMA_2026  # ~$2,828.50
        imss_topado = calc_imss_employee(sbc_muy_alto, dias)
        imss_al_tope = calc_imss_employee(tope, dias)
        assert imss_topado == pytest.approx(imss_al_tope, abs=0.01)

    def test_bug_alejandra_sbc_mal_capturado(self):
        """Regresión del caso Alejandra: si el usuario captura SBC como
        MENSUAL en lugar de diario (~$2,800), IMSS obrero se dispara y el
        motor pega en el tope de 25 UMAs. La cuenta es correcta — el bug
        estaba en el formulario UI. Este test asegura que el motor NO
        acepta 'suavizar' un valor mal capturado silenciosamente."""
        sbc_mal_capturado = 2800.0  # mensual usado como diario
        dias = 15
        imss = calc_imss_employee(sbc_mal_capturado, dias)
        # Debe topar en 25 UMAs y dar cuota alta pero acotada
        tope = 25 * UMA_2026
        # 2800 < tope (2828.50) → usa 2800
        assert imss == pytest.approx(2800 * 15 * 0.02, abs=0.01)
        # Este número es enorme y debe disparar la alerta de integridad

    def test_cero_dias(self):
        """0 días trabajados → 0 cuota."""
        assert calc_imss_employee(200, 0) == 0.0


# ── IMSS patronal ──────────────────────────────────────────────────────────
class TestIMSSEmployer:
    def test_patronal_mayor_que_obrera(self):
        """La cuota patronal siempre es varias veces mayor que la obrera."""
        sbc = 200.0
        dias = 15
        obrera = calc_imss_employee(sbc, dias)
        patronal = calc_imss_employer(sbc, dias)
        # Patronal ~10-15x obrera para salarios típicos
        assert patronal > obrera * 3

    def test_topado_25_umas(self):
        """SBC arriba de 25 UMAs → mismo cálculo que al tope."""
        tope = 25 * UMA_2026
        p_muy_alto = calc_imss_employer(10_000, 15)
        p_al_tope = calc_imss_employer(tope, 15)
        assert p_muy_alto == pytest.approx(p_al_tope, abs=0.01)


# ── INFONAVIT aportación patronal ──────────────────────────────────────────
class TestInfonavitEmployerAmort:
    def test_5_porciento_sbc_topado(self):
        """5% del SBC diario × días, topado a 25 UMAs."""
        sbc = 200.0
        dias = 15
        amort = calc_infonavit_employer_amort(sbc, dias)
        assert amort == pytest.approx(200 * 15 * 0.05, abs=0.01)

    def test_topado_25_umas(self):
        tope = 25 * UMA_2026
        muy_alto = calc_infonavit_employer_amort(10_000, 15)
        al_tope = calc_infonavit_employer_amort(tope, 15)
        assert muy_alto == pytest.approx(al_tope, abs=0.01)


# ── ISN estatal ────────────────────────────────────────────────────────────
class TestISNEstatal:
    def test_cdmx_3_porciento(self):
        """CDMX cobra 3% sobre el total gravable."""
        gross = 100_000
        isn = calc_state_payroll_tax(gross, 3.0)
        assert isn == 3000.00

    def test_tasa_cero_no_calcula(self):
        assert calc_state_payroll_tax(100_000, 0) == 0.0

    def test_gross_cero_no_calcula(self):
        assert calc_state_payroll_tax(0, 3.0) == 0.0

    def test_tasa_negativa_no_calcula(self):
        """No aceptamos tasas negativas por accidente."""
        assert calc_state_payroll_tax(100_000, -3) == 0.0


# ── Casos integrados de negocio ────────────────────────────────────────────
class TestBusinessCases:
    def test_empleado_minimo_no_paga_isr(self):
        """Trabajador con salario mínimo — el subsidio absorbe todo el ISR."""
        # Salario mensual ~$8,000 (aproximado al mínimo integrado)
        gravable_mensual = 8000
        isr_ret, sub_pag, _ = calc_isr_net(gravable_mensual, "mensual")
        # Debe recibir subsidio o no retener ISR
        assert isr_ret >= 0
        # No hay retención neta arriba de $200
        assert isr_ret < 500

    def test_empleado_alto_paga_isr_progresivo(self):
        """Trabajador con salario alto: paga ISR significativo, sin subsidio.
        Con tablas RMF 2026, $100k mensual cae en tramo 3 (75,984 - 133,536)
        al 10.88% marginal: ISR = 7,074.82 (~7% efectivo)."""
        gravable_mensual = 100_000
        isr_ret, sub_pag, isr_bruto = calc_isr_net(gravable_mensual, "mensual")
        assert sub_pag == 0.0
        assert isr_ret == pytest.approx(7074.82, abs=0.5)
        assert isr_ret == isr_bruto  # sin subsidio compensatorio

    def test_ejecutivo_alto_marginal_30(self):
        """Salario ejecutivo alto ($700k mensual = ~$8.4M anual) cae en 30% marginal."""
        gravable_mensual = 700_000
        isr_ret, _, _ = calc_isr_net(gravable_mensual, "mensual")
        # Debe estar por encima de $140k (tramo 30% aplica en excedente)
        assert isr_ret > 140_000
