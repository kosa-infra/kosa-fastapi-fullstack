from typing import Any

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    PROXMOX_HOST: str
    PROXMOX_USER: str
    PROXMOX_TOKEN_NAME: str
    PROXMOX_TOKEN_VALUE: str

    PROXMOX_HOST2: str
    PROXMOX_USER2: str
    PROXMOX_TOKEN_NAME2: str
    PROXMOX_TOKEN_VALUE2: str

    @property
    def PROXMOX_CLUSTERS(self) -> dict[str, dict]:
        return {
            "cluster_a": {
                "host": self.PROXMOX_HOST,
                "user": self.PROXMOX_USER,
                "token_name": self.PROXMOX_TOKEN_NAME,
                "token_value": self.PROXMOX_TOKEN_VALUE,
            },
            "cluster_b": {
                "host": self.PROXMOX_HOST2,
                "user": self.PROXMOX_USER2,
                "token_name": self.PROXMOX_TOKEN_NAME2,
                "token_value": self.PROXMOX_TOKEN_VALUE2,
            },
        }

    VM_TEMPLATE: dict[str, Any] = {
        "vcpu": 1,
        "memory": 1024,
        "resize": 10,
        "cpu": "Skylake-Client-v4",
        "agent": 1,
        "cicustom": "vendor=local:snippets/vendor-config.yaml",
        "ciuser": "ubuntu",
        "cipassword": "password",
        "ipconfig0": "ip=dhcp",
    }

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
