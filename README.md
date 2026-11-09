# Liquidity Vault — наша работа за неделю 9

Мы продолжаем проект с восьмой недели. В этой ветке добавили депозит: пользователь переводит SPL-токены в vault и получает share-токены, которые показывают его долю. Вывода из vault и подключения к внешнему пулу ликвидности пока нет.

Контракт написан на Anchor 0.31.1. SBF toolchain Solana закреплён в `Anchor.toml`, версии Rust-зависимостей зафиксированы в `Cargo.lock`.

## Что умеет наша программа

- `initialize_vault` создаёт настройки, token account для vault и mint share-токенов.
- `create_user_card` создаёт пользователю одну PDA-карточку для vault.
- `deposit(amount)` переводит пользовательские токены в vault и выпускает shares.

### Задание 8: vault и карточки

`VaultState` хранит адрес администратора, mint принимаемого токена, адреса token account и share mint, а также общий объём депозитов. Token account принадлежит SPL Token Program, но распоряжается им PDA `VaultState`. У share mint mint authority тоже находится у PDA vault.

`UserCard` вычисляется из seeds `user_card`, адреса vault и кошелька пользователя. Карточку можно найти по этим адресам, список всех пользователей программе не нужен.

### Задание 9: депозит и shares

Пользователь вызывает `deposit(amount)` и подписывает транзакцию. Инструкция проверяет его карточку и token account. Mint, authority и адрес vault также проверяются по сохранённым настройкам.

Дальше программа делает два CPI-вызова к SPL Token Program:

1. `transfer` переводит токены из token account пользователя в хранилище vault.
2. `mint_to` выпускает share-токены на share account пользователя. Для этого программа подписывает CPI seeds и bump PDA `VaultState`.
3. `total_deposited` в настройках и `deposited` в карточке пользователя увеличиваются на сумму депозита.

Первый депозит выпускает shares 1:1. Для следующих депозитов используем формулу:

```text
shares = amount × share_mint.supply / vault.total_deposited
```

Общий объём shares берём из supply share mint, поэтому не дублируем его отдельным полем в `VaultState`. Расчёт использует промежуточное значение `u128`. Нулевой депозит, переполнение и сумма, которая после округления дала бы ноль shares, отклоняются. Share mint создаётся с теми же decimals, что и принимаемый mint.

### Что проверили

`anchor build` собрал программу и IDL. `yarn tsc --noEmit` проверил TypeScript-скрипт для депозита. Сам депозит через эту версию в devnet пока не проводили: публичный faucet ограничил запрос тестового SOL, поэтому week-9 программа пока не обновлена в сети.

## Как запустить

Нужны Rust stable, Node.js 22, Yarn, Solana CLI и Anchor CLI 0.31.1. Для Windows шаги установки WSL2/Ubuntu есть в [README недели 8](https://github.com/BerikbaiNurai/Solana-course-/blob/week-8/README.md). Также можно воспользоваться [официальной инструкцией Solana](https://solana.com/docs/intro/installation) и [инструкцией Anchor](https://www.anchor-lang.com/docs/installation).

```bash
git clone --branch week-9 https://github.com/BerikbaiNurai/Solana-course-.git
cd Solana-course-
yarn install
anchor build
```

Чтобы развернуть собственную копию, настройте devnet-кошелёк с тестовым SOL. Создайте program keypair, синхронизируйте ID, затем соберите и разверните программу:

```bash
mkdir -p target/deploy
solana-keygen new --no-bip39-passphrase -o target/deploy/liquidity_vault-keypair.json
anchor keys sync
solana config set --url devnet
anchor build
anchor deploy --provider.cluster devnet
```

Program keypair и приватный ключ кошелька в репозитории не хранятся. После деплоя создайте mint, vault и карточку пользователя:

```bash
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET="$HOME/.config/solana/id.json" \
yarn setup:devnet
```

Для тестового mint, созданного `setup:devnet`, можно выпустить токены на кошелёк и сразу внести их. Скрипт создаст token ATA и share ATA, а если карточки ещё нет — откроет её:

```bash
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET="$HOME/.config/solana/id.json" \
yarn deposit:devnet <TOKEN_MINT_ADDRESS> 1.5 --mint-demo
```

`--mint-demo` работает, только если настроенный кошелёк является authority этого mint. Для другого токена уберите флаг и заранее пополните token account.

## Аккаунты в Devnet

Эти ссылки относятся к базовой версии недели 8. Ветка недели 9 содержит депозит в исходном коде, но эта версия ещё не развернута в devnet. После нового деплоя program ID и адреса аккаунтов будут зависеть от созданного keypair и mint.

| Объект | Explorer |
|---|---|
| Базовая программа | [7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S](https://explorer.solana.com/address/7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S?cluster=devnet) |
| Mint тестового токена | [3ZF2ErKWGGpZAK4HEWPTgk4kxF95avg5qEKSZS8R7fVm](https://explorer.solana.com/address/3ZF2ErKWGGpZAK4HEWPTgk4kxF95avg5qEKSZS8R7fVm?cluster=devnet) |
| `VaultState` | [5tTHydct51S4mUeP3YHfgVkvv58fVQFQ2gxkbKGMmob6](https://explorer.solana.com/address/5tTHydct51S4mUeP3YHfgVkvv58fVQFQ2gxkbKGMmob6?cluster=devnet) |
| Token account vault | [EQuEpnsP7Ld6tcbrG46ViJ5pMMA76fLnvNvZyyqTLxqp](https://explorer.solana.com/address/EQuEpnsP7Ld6tcbrG46ViJ5pMMA76fLnvNvZyyqTLxqp?cluster=devnet) |
| Share mint | [FxNGzH6bM7u2nNSwR2vMYhhG72wJRQ9DwpCm3kiLpgAp](https://explorer.solana.com/address/FxNGzH6bM7u2nNSwR2vMYhhG72wJRQ9DwpCm3kiLpgAp?cluster=devnet) |
| Карточка пользователя | [4o6tfffq4AFVLXQ5sEMnh9HHeDXmVM83QcSns6hAw8h9](https://explorer.solana.com/address/4o6tfffq4AFVLXQ5sEMnh9HHeDXmVM83QcSns6hAw8h9?cluster=devnet) |

## Что мы поняли

- Пользователь подписывает перевод токенов, а PDA vault подписывает выпуск shares.
- Количество shares зависит от того, сколько токенов уже находится в vault и сколько shares уже выпущено.
- Карточка и share account нужны для разных задач: карточка хранит сумму депозитов, share account хранит сами токены-квитанции.
- Проверки mint и authority не дают подменить token account или получить shares на чужой кошелёк.
