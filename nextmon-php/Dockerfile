# NextMON - PHP built-in server image (UNTESTED - build and verify before production use).
# For anything exposed to the internet prefer php-fpm + nginx (deploy/nginx.conf) or put TLS in front of this container.
# The official php image already ships openssl + curl + mbstring; pdo_sqlite is bundled too.
FROM php:8.3-cli-alpine

WORKDIR /app
COPY . /app
# hardening: production ini, data dir owned by the unprivileged user, secrets never baked into the image
RUN cp /app/deploy/php-hardening.ini /usr/local/etc/php/conf.d/99-nextmon.ini \
 && mkdir -p /app/data \
 && chown -R www-data:www-data /app/data \
 && chmod 0750 /app/data \
 && rm -rf /app/tests /app/docs /app/public/preview

# Persist router config, users and the encryption key (data/secret.key) outside the container
VOLUME ["/app/data"]
ENV NEXTMON_DATA=/app/data
# NEXTMON_DEMO=1 forces the built-in simulator for every router
ENV NEXTMON_DEMO=0
# Behind a reverse proxy set NEXTMON_TRUSTED_PROXIES (its address/CIDR) so X-Forwarded-For/Proto are honoured; unset = ignored.
# Public deployments: set NEXTMON_SETUP_TOKEN and open /setup?token=... once, so a stranger cannot claim the admin account.

EXPOSE 8080
USER www-data
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/offline || exit 1
CMD ["php", "-S", "0.0.0.0:8080", "-t", "/app/public"]
