# CloudPanel / Nginx SPA Fallback

Para uma SPA em React com `react-router-dom`, o Nginx precisa devolver `index.html`
quando a rota solicitada nao existir como arquivo fisico.

Use este bloco no vhost do site:

```nginx
location / {
  try_files $uri $uri/ /index.html;
}

location /assets/ {
  expires 1y;
  add_header Cache-Control "public, immutable";
  try_files $uri =404;
}
```

Sem isso, acessos diretos como `/apoiadores`, `/monitoramento` e refresh com `F5`
vao cair em `404 Not Found` no Nginx.
