from typing import Any

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    PROXMOX_HOST: str
    PROXMOX_USER: str
    PROXMOX_TOKEN_NAME: str
    PROXMOX_TOKEN_VALUE: str

    VM_TEMPLATE: dict[str, Any] = {
        "vcpu": 1,
        "memory": 1024,
        "resize": 10,
        "cpu": "",
        "agent": 1,
        "cicustom": "",
        "ciuser": "ubuntu",
        "cipassword": "password",
        "ipconfig0": "ip=dhcp",
    }

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
