FROM mcr.microsoft.com/playwright@sha256:b27e719ecbfef153e13fd24e8341736733bf2658b229677eb21ff57ff5d7fb29

RUN curl --fail --silent --show-error --location https://nodejs.org/dist/v24.8.0/node-v24.8.0-linux-x64.tar.xz -o /tmp/node.tar.xz \
    && echo "2598641d188b41793930917f1a99a81c9615856b4205d408a44ab676c1acbb3d  /tmp/node.tar.xz" | sha256sum --check \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.xz

WORKDIR /work
COPY . /work
RUN npm ci --ignore-scripts --no-audit --no-fund \
    && mkdir -p dist .astro coverage playwright-report test-results node_modules/.vite \
    && chmod -R a-w /work /usr/local/lib/node_modules

USER 1001:1001
ENV CI=true HOME=/tmp/home PLAYWRIGHT_BROWSERS_PATH=/tmp/browsers \
    NPM_CONFIG_USERCONFIG=/dev/null NPM_CONFIG_GLOBALCONFIG=/dev/null \
    NPM_CONFIG_SCRIPT_SHELL=/bin/bash BASH_ENV=/dev/null
