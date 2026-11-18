# Pega Primata

Pega-pega (modo infecção) em que você **anda só com os braços**, para **VR (APK do Meta Quest)**
e **PC (EXE)**. Feito em HTML + JavaScript (three.js + WebXR), com atualização automática.

- **Movimento VR:** é um port linha a linha do sistema de locomoção que a Another Axiom
  publicou como código aberto (MIT): [GorillaLocomotion/Player.cs](https://github.com/Another-Axiom/GorillaLocomotion).
  Os valores são os do prefab oficial: histórico de velocidade 8, braço 1.5 m, limite 0.4,
  pulo máx. 6.5 × 1.1, mão r 0.05, cabeça r 0.15, corpo em cápsula r 0.15 × 0.5, deslize 0.03 e precisão 0.995.
  A física de colisão (`web/js/physics.js`) reproduz a semântica do `Physics.SphereCast` do Unity.
- **Pegador:** fica mais rápido (pulo máx. 8.5 × 1.3).
- **Nome, personagem e mapa:** são originais (Ruínas do Cipó).

## Estrutura

| Pasta | O que é |
|---|---|
| `web/` | O jogo (site estático). `js/locomotion.js` = motor dos braços |
| `server/` | Servidor Node: serve o `web/` + multiplayer WebSocket (`/ws`) |
| `desktop/` | App de PC (Electron) → gera o **EXE** com auto-update |
| `quest/` | Guia para gerar o **APK** do Quest |
| `tools/` | Ícones e `bump.js` (sobe a versão do jogo) |

## Rodar no seu PC

```bash
cd server
```

```bash
npm install
```

```bash
npm start
```

Abra http://localhost:8080. Para testar o multiplayer, abra duas abas com o mesmo código de sala.

## Publicar (necessário para o VR e para o multiplayer pela internet)

1. Crie um repositório no GitHub (ex.: `pega-primata`) e envie esta pasta.
2. No [Render](https://render.com): **New → Blueprint** e escolha o repositório. O
   `render.yaml` já configura tudo. Você recebe um endereço como `https://pega-primata.onrender.com`.
3. No VR: abra esse endereço no navegador do Quest (ou gere o APK, veja `quest/COMO-GERAR-APK.md`).

> No plano grátis, o Render "dorme" depois de um tempo parado e leva uns 30 s para acordar.

## Como funciona a atualização automática

| Onde | Como atualiza |
|---|---|
| Conteúdo do jogo (todas as plataformas) | O APK e o EXE abrem o jogo do servidor. Rode `node tools/bump.js`, faça commit e push: o Render publica sozinho e os jogadores com o jogo aberto recebem "Nova versão! Atualizando..." (no VR, a atualização acontece ao sair do VR). |
| EXE (o programa em si) | `electron-updater` confere os GitHub Releases a cada 30 min, baixa em segundo plano e oferece reiniciar. |
| APK | Não precisa: ele é só a "casca" que abre o site. |

### Configurar o EXE

1. Em `desktop/config.json`, coloque `"gameUrl": "https://SEU-DOMINIO"`.
2. Em `desktop/package.json`, troque `SEU_USUARIO_GITHUB` pelo seu usuário do GitHub.
3. Em `web/js/config.js`, coloque `wss://SEU-DOMINIO/ws` (usado quando o EXE abre sem internet).

Gerar o instalador localmente (sai em `desktop/dist/`):

```bash
cd desktop
```

```bash
npm install
```

```bash
npm run dist
```

Para publicar uma versão nova do EXE com auto-update, crie uma tag. O GitHub Actions
(`.github/workflows/desktop-release.yml`) gera o EXE e publica o Release:

```bash
git tag v1.0.1
```

```bash
git push origin v1.0.1
```

## Controles

**VR:** empurre o chão e as paredes com as mãos. A mão gruda onde encosta e o corpo vai
para o lado oposto; ao soltar, a velocidade vira pulo. Analógico direito = giro de 45°.
B/Y = renascer. Toque os botões do quadro para trocar de cor ou de sala.

**PC:** WASD = remar com os braços (o mesmo motor de física; olhe para cima para escalar).
Mouse = olhar. Espaço = pular. Shift = correr. Clique esquerdo/direito = tapa (pega os outros).
R = renascer. Esc = menu. F11 = tela cheia (EXE).

## Modo infecção

Com 2 ou mais jogadores, um é sorteado como pegador (laranja). Quem é pego vira pegador.
Quando todos forem pegos, começa uma nova rodada. Há 3 s de proteção no começo de cada rodada.
Cada sala tem até 10 jogadores. Deixe o código vazio para entrar numa sala pública.
