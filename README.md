# Неделя 9 — депозит и share-токены

В этой версии проекта я добавила депозит. Пользователь переводит свои SPL-токены в хранилище vault, а программа выпускает ему share-токены — квитанцию о его доле. Пока пользователь вносит токены только в наш vault; подключение к внешнему liquidity pool и вывод будут отдельными следующими шагами.

## Что происходит при депозите

Вызов `deposit(amount)` проверяет пользователя, его карточку и token account. После проверок программа делает два CPI-вызова к SPL Token Program:

1. `transfer` отправляет токены пользователя в token account vault.
2. `mint_to` выпускает share-токены на кошелёк пользователя. В качестве mint authority выступает PDA vault, и программа подписывает CPI своими seeds.
3. Программа увеличивает `total_deposited` в настройках и `deposited` в карточке пользователя.

На первом депозите пользователь получает shares 1:1. Для следующих депозитов я использовала такую формулу:

```text
shares = amount × share_mint.supply / vault.total_deposited
```

Supply share mint здесь используется как общее количество долей. Так мне не пришлось добавлять ещё одно поле с теми же данными и менять размер аккаунтов, созданных на восьмой неделе. В расчёте используется `u128`, а нулевой депозит, переполнение и сумма, при которой shares округляются до нуля, отклоняются.

## Аккаунты проекта

| Аккаунт | Для чего нужен | Кто управляет |
|---|---|---|
| `VaultState` | Хранит администратора, mint токена, адреса vault и share mint, общий объём депозитов | Программа; PDA |
| Token account vault | Хранит токены пользователей | SPL Token Program; authority — PDA `VaultState` |
| Share mint | Выпускает квитанции о доле пользователя | Mint authority — PDA `VaultState` |
| `UserCard` | Хранит vault, владельца карточки и внесённую им сумму | Программа; PDA |
| Токен-аккаунт пользователя | Источник токенов для депозита | Пользователь |
| Share-аккаунт пользователя | Получает новые share-токены | Пользователь |

Для `deposit` передаются только аккаунты с нужными mint и authority. Карточка выводится из seeds `["user_card", vault_state, user_wallet]`, поэтому программа проверяет, что она принадлежит именно этому пользователю и vault.

## Как попробовать депозит

Для запуска нужны WSL2/Ubuntu, Rust, Node.js, Yarn, Solana CLI и Anchor CLI 0.31.1. Я закрепила SBF toolchain Solana 2.1.0 в `Anchor.toml`, а совместимые Rust-зависимости — в `Cargo.lock`. Если инструменты ещё не установлены, я оставила шаги для WSL в [README восьмой недели](https://github.com/BerikbaiNurai/Solana-course-/blob/week-8/README.md).

```bash
git clone --branch week-9 https://github.com/BerikbaiNurai/Solana-course-.git
cd Solana-course-
yarn install
```

Сначала создайте собственный program keypair, обновите ID и соберите программу. Приватный ключ программы нельзя добавлять в Git:

```bash
mkdir -p target/deploy
solana-keygen new --no-bip39-passphrase -o target/deploy/liquidity_vault-keypair.json
anchor keys sync
anchor build
solana config set --url devnet
anchor deploy --provider.cluster devnet
```

Затем создайте тестовый mint и аккаунты vault. Команда ниже предполагает, что кошелёк находится по стандартному пути; если файл лежит в другом месте, измените `ANCHOR_WALLET`:

```bash
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET="$HOME/.config/solana/id.json" \
yarn setup:devnet
```

Для депозита скрипт создаст token ATA и share ATA. Если карточки ещё нет, он откроет её. Сумма указывается в обычных токенах. Для тестового mint скрипт может сначала выпустить такую же сумму токенов на кошелёк (`--mint-demo`):

```bash
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET="$HOME/.config/solana/id.json" \
yarn deposit:devnet <TOKEN_MINT_ADDRESS> 1.5 --mint-demo
```

Флаг `--mint-demo` сработает только для mint, где текущий кошелёк является mint authority. Для настоящего токена уберите этот флаг и заранее пополните свой token account.

## Проверка и devnet

Я проверила сборку командой `anchor build` и TypeScript-командой `yarn tsc --noEmit`. Программа недели 9 пока не обновлена в devnet: запрос SOL из devnet faucet попал под ограничение. Поэтому ссылки ниже ведут на аккаунты базовой версии недели 8; чтобы попробовать `deposit`, сначала нужно развернуть сборку этой ветки и создать новый vault.

| Что открыть | Адрес |
|---|---|
| Базовая программа недели 8 | [7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S](https://explorer.solana.com/address/7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S?cluster=devnet) |
| Mint принимаемого тестового токена | [3ZF2ErKWGGpZAK4HEWPTgk4kxF95avg5qEKSZS8R7fVm](https://explorer.solana.com/address/3ZF2ErKWGGpZAK4HEWPTgk4kxF95avg5qEKSZS8R7fVm?cluster=devnet) |
| Настройки `VaultState` | [5tTHydct51S4mUeP3YHfgVkvv58fVQFQ2gxkbKGMmob6](https://explorer.solana.com/address/5tTHydct51S4mUeP3YHfgVkvv58fVQFQ2gxkbKGMmob6?cluster=devnet) |
| Token account vault | [EQuEpnsP7Ld6tcbrG46ViJ5pMMA76fLnvNvZyyqTLxqp](https://explorer.solana.com/address/EQuEpnsP7Ld6tcbrG46ViJ5pMMA76fLnvNvZyyqTLxqp?cluster=devnet) |
| Share mint | [FxNGzH6bM7u2nNSwR2vMYhhG72wJRQ9DwpCm3kiLpgAp](https://explorer.solana.com/address/FxNGzH6bM7u2nNSwR2vMYhhG72wJRQ9DwpCm3kiLpgAp?cluster=devnet) |
| Карточка пользователя | [4o6tfffq4AFVLXQ5sEMnh9HHeDXmVM83QcSns6hAw8h9](https://explorer.solana.com/address/4o6tfffq4AFVLXQ5sEMnh9HHeDXmVM83QcSns6hAw8h9?cluster=devnet) |

## Что я поняла

- Пользователь подписывает перевод своих токенов, а PDA vault подписывает выпуск share-токенов.
- PDA не имеет приватного ключа: программа подписывает за него только с правильными seeds и bump.
- Share-токены отражают долю в vault. Поэтому после первого депозита количество выдаваемых shares зависит от общего token balance и текущего supply share mint.
- Token account пользователя и share account должны принадлежать тому же кошельку, который подписывает депозит.
