# NginxManager

Auto-generate nginx reverse proxy configs based on labels on docker services.

Managed by the label `xyz.tangerie.reverse_proxy`, services need to be on `nginx-proxy-overlay`. The generator watches docker events and reloads nginx when the config changes.

| Label | |
|---|---|
| `xyz.tangerie.reverse_proxy.path` | required |
| `xyz.tangerie.reverse_proxy.port` | required |
| `xyz.tangerie.reverse_proxy.server_name` | optional, otherwise default server |
| `xyz.tangerie.reverse_proxy.no_trailing_slash` | `"true"` to keep the path prefix |

E.g in a stack called `everything-codex`

```yml
nginx:
    image: nginx:alpine
    deploy:
        replicas: 1
        labels:
            xyz.tangerie.reverse_proxy.path: "/codex"
            xyz.tangerie.reverse_proxy.port: "80"
    networks:
        - nginx-proxy-overlay
```

```nginx
location ^~ /codex/ {
    include /etc/nginx/snippets/proxy_header.conf;
    set $upstream everything-codex_nginx:80;
    rewrite "^/codex(/.*)$" $1 break;
    proxy_pass http://$upstream;
}
```

https://github.com/nginx-proxy/nginx-proxy
