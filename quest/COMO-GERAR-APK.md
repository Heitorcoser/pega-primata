# Gerar o APK do Meta Quest

O APK é um "PWA empacotado": um app nativo do Quest que abre o jogo do seu servidor
(HTTPS). Por isso **a atualização é automática**: cada deploy novo do site já chega no
APK na próxima vez que o jogo abrir, sem reinstalar nada.

Esse é o caminho oficial da Meta (Bubblewrap com suporte ao Quest):
https://developers.meta.com/horizon/documentation/web/pwa-packaging/

## Pré-requisitos

1. Node.js 18 ou mais novo.
2. O jogo publicado em HTTPS (veja o `README.md` na raiz: deploy no Render).
   Exemplo usado aqui: `https://pega-primata.onrender.com`.
3. O Quest em **Modo Desenvolvedor** e o `adb` (Android Platform Tools) no PC.

## Passo a passo

```bash
npm install --global @meta-quest/bubblewrap-cli
```

```bash
mkdir app
```

```bash
cd app
```

```bash
bubblewrap init --manifest=https://pega-primata.onrender.com/manifest.webmanifest --metaquest
```

Respostas sugeridas:

- **App mode:** `immersive`, para abrir direto no VR, ou `2D`, para abrir o menu numa janela e entrar no VR pelo botão "Entrar no VR". O `2D` é mais simples e é o recomendado para começar.
- **Package identifier:** `com.pegaprimata.game`. Guarde esse nome: toda atualização do APK precisa usar o mesmo.
- **Display mode:** `standalone`. **Orientation:** `landscape`.
- **Horizon Billing:** não.
- **Signing key:** deixe o Bubblewrap criar uma e **guarde a keystore e as senhas** (sem elas, você não consegue atualizar o APK depois).

Depois, ajuste o projeto Gradle gerado, como pede a documentação da Meta:

- Em `app/build.gradle`, use `targetSdk = 32`, com a linha `//noinspection ExpiredTargetSdkVersion` acima dela.
- Se aparecer `jcenter()`, troque por `mavenCentral()`.

Gere o APK:

```bash
bubblewrap build
```

Instale no Quest (ligado no USB, com Modo Desenvolvedor):

```bash
adb install -r app-release-signed.apk
```

O jogo aparece em **Biblioteca → Fontes desconhecidas**.

## Tirar a barra de endereço (Digital Asset Links)

1. Pegue a impressão digital SHA-256 da sua chave:

```bash
keytool -list -v -keystore android.keystore -alias android
```

2. Rode o comando abaixo. Ele gera o `assetlinks.json`:

```bash
bubblewrap fingerprint add <SHA256>
```

3. Copie o conteúdo gerado para `web/.well-known/assetlinks.json` e faça o deploy.
   O arquivo precisa abrir em `https://SEU-DOMINIO/.well-known/assetlinks.json`.

## Quando preciso gerar o APK de novo?

Quase nunca. Mudanças no jogo (mapa, física, modos, correções) vão só para o servidor.
Só gere de novo se mudar o ícone, o nome, o domínio ou o modo do app (2D/imersivo). Nesse
caso, aumente o `appVersionCode` no `twa-manifest.json`, rode `bubblewrap update` e depois
`bubblewrap build`.

## Testar sem APK

Abra `https://SEU-DOMINIO` no **navegador do Quest** e toque em "Entrar no VR". É exatamente o
mesmo jogo.
