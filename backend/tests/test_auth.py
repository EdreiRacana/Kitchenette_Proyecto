import pytest


ADMIN_EMAIL = "admin@sthenova-test.example.com"
ADMIN_PASSWORD = "S3cur3-Password!"


async def _bootstrap_admin(client):
    res = await client.post(
        "/api/v1/auth/setup",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD, "full_name": "Admin"},
    )
    return res


@pytest.mark.asyncio
async def test_setup_creates_first_admin(client):
    res = await _bootstrap_admin(client)
    assert res.status_code == 200
    body = res.json()
    assert body["email"] == ADMIN_EMAIL
    assert body["is_superuser"] is True


@pytest.mark.asyncio
async def test_setup_disabled_once_user_exists(client):
    await _bootstrap_admin(client)
    res = await client.post(
        "/api/v1/auth/setup",
        json={"email": "second@sthenova-test.example.com", "password": "Whatever123!", "full_name": "Second"},
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_login_success_returns_token(client):
    await _bootstrap_admin(client)
    res = await client.post(
        "/api/v1/auth/login",
        data={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["access_token"]
    assert body["token_type"] == "bearer"
    assert body["requires_2fa"] is False


@pytest.mark.asyncio
async def test_login_wrong_password_rejected(client):
    await _bootstrap_admin(client)
    res = await client.post(
        "/api/v1/auth/login",
        data={"username": ADMIN_EMAIL, "password": "wrong-password"},
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_login_superuser_must_setup_2fa(client):
    await _bootstrap_admin(client)
    res = await client.post(
        "/api/v1/auth/login",
        data={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    body = res.json()
    # El admin (superusuario) no tiene 2FA activo todavia: el backend debe
    # marcar must_setup_2fa para forzar el banner en el frontend.
    assert body["must_setup_2fa"] is True


@pytest.mark.asyncio
async def test_me_requires_authentication(client):
    res = await client.get("/api/v1/auth/me")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_me_returns_current_user(client):
    await _bootstrap_admin(client)
    login = await client.post(
        "/api/v1/auth/login",
        data={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    token = login.json()["access_token"]
    res = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["email"] == ADMIN_EMAIL


@pytest.mark.asyncio
async def test_permissions_endpoint_reflects_superuser(client):
    await _bootstrap_admin(client)
    login = await client.post(
        "/api/v1/auth/login",
        data={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    token = login.json()["access_token"]
    res = await client.get("/api/v1/auth/me/permissions", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["is_superuser"] is True
