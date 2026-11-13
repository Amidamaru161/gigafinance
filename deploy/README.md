# Деплой GigaFinance на сервер с пользователями

Схема: nginx спрашивает логин/пароль (HTTP basic auth) и по логину проксирует
на личный экземпляр `dsh web` этого пользователя (свой профиль, сессии и
рабочая папка, порт 8801+ на 127.0.0.1). Пользователи не видят чужих чатов.

```bash
sudo bash deploy/setup.sh                 # один раз: node, nginx, сборка в /opt/gigafinance
sudo nano /etc/gigafinance/secrets.env    # ключ модели и токен MCP
sudo /opt/gigafinance/deploy/add-user.sh alice
sudo /opt/gigafinance/deploy/add-user.sh --remove alice
```

Обновление: `sudo bash /opt/gigafinance/deploy/setup.sh`, затем
`sudo systemctl restart 'gigafinance@*'`.

Пароли идут по сети в открытом виде, пока нет HTTPS. С доменом:
`apt install certbot python3-certbot-nginx && certbot --nginx -d <домен>`.
