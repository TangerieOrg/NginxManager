# NginxManager

Auto-generate nginx reverse proxy configs based on labels on docker services.

Managed by the label `xyz.tangerie.reverse_proxy`

E.g in a stack called `everything-codex`

```yml
nginx:
    ports:
        - 80:80
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
    client_max_body_size 0;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_pass http://everything-codex_nginx:80/;    
}

```

https://github.com/nginx-proxy/nginx-proxy