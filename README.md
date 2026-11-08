# Liquidity Vault — каркас недели 8

Учебная Anchor-программа для РК1. Она создаёт структуру vault в Solana devnet: настройки, PDA-хранилище принимаемого SPL-токена, mint share-токена и персональную PDA-карточку. Инструкций для депозита и вывода здесь пока нет — на этом этапе средства ещё не перемещаются.

## Схема аккаунтов

```mermaid
flowchart TD
    Admin[Администратор · подписывает создание]
    User[Пользователь · подписывает открытие карточки]
    Mint[SPL mint принимаемого токена]
    State[VaultState PDA · seeds: vault + token mint]
    Custody[TokenAccount PDA · seeds: token_vault + token mint]
    Share[Share mint PDA · seeds: share_mint + token mint]
    Card[UserCard PDA · seeds: user_card + vault + user]

    Admin -->|payer и admin| State
    User -->|payer и владелец| Card
    Mint -->|указан в настройках| State
    State -->|authority| Custody
    State -->|mint authority| Share
    State -->|связанная позиция| Card
```

| Аккаунт | Владелец / authority | Содержимое |
|---|---|---|
| `VaultState` | программа (PDA) | администратор, mint принимаемого токена, адреса хранилища и share mint, общий внесённый объём, bump |
| `TokenAccount` хранилища | `VaultState` PDA | SPL-токены vault; на неделе 8 баланс остаётся нулевым |
| `Mint` share-токена | mint authority — `VaultState` PDA | receipt-токен с 6 decimals; в этой версии выпуск ещё не открыт |
| `UserCard` | программа (PDA) | vault, владелец, сумма внесённых токенов (пока 0), bump |

PDA не имеет соответствующего приватного ключа. Программа проверяет seeds и bump при каждом доступе. Поэтому только её инструкции смогут подписать CPI от имени `VaultState` для управления токен-аккаунтом и выпуска share-токенов.

## PDA и адреса

- Vault: `["vault", token_mint]`
- Хранилище: `["token_vault", token_mint]`
- Share mint: `["share_mint", token_mint]`
- Карточка: `["user_card", vault_state, user_wallet]`

Карточка пользователя однозначно выводится из адресов vault и кошелька; отдельный список пользователей хранить не нужно. В одном vault для одного кошелька может быть одна карточка.

## Установка инструментов на Windows

Для сборки Solana-программ в Windows используйте WSL2 с Ubuntu. Официальный установщик Solana поддерживает Windows через WSL; команды ниже выполняются в двух разных терминалах.

### 1. Установите WSL2

Сначала проверьте, установлен ли Ubuntu:

```powershell
wsl --list --verbose
```

Если Ubuntu уже есть в списке, запустите `wsl -d Ubuntu`. Если его нет, откройте PowerShell **от имени администратора** и выполните `wsl --install -d Ubuntu`. Перезагрузите Windows, если установщик попросит; затем откройте Ubuntu из меню «Пуск» и задайте имя и пароль Linux-пользователя.

### 2. Установите Rust, Node.js и инструменты Solana

В терминале Ubuntu:

```bash
sudo apt update
sudo apt install -y build-essential pkg-config libudev-dev libssl-dev curl git

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
. "$HOME/.cargo/env"
rustup default stable

curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
. ~/.bashrc
nvm install 22
npm install --global yarn

sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc

cargo install --git https://github.com/solana-foundation/anchor avm --force
avm install 0.31.1
avm use 0.31.1
```

Закройте и снова откройте Ubuntu, затем проверьте версии:

```bash
rustc --version
node --version
yarn --version
solana --version
anchor --version
```

Ожидаемая версия Anchor CLI — `anchor-cli 0.31.1`. Установленная команда `solana --version` может показывать более новую версию CLI; для сборки Anchor использует закреплённый в `Anchor.toml` SBF toolchain Solana `2.1.0`.

### 3. Скачайте ветку проекта

```bash
git clone --branch week-8 https://github.com/BerikbaiNurai/Solana-course-.git
cd Solana-course-
yarn install
```

В репозитории сохранён `Cargo.lock`: он фиксирует версии Rust-зависимостей, совместимые с SBF toolchain Solana 2.1. Не удаляйте его перед сборкой.

### 4. Создайте program ID и соберите программу

В каталоге проекта создайте отдельный keypair **для адреса программы** и синхронизируйте его адрес с исходным кодом:

```bash
mkdir -p target/deploy
solana-keygen new --no-bip39-passphrase -o target/deploy/liquidity_vault-keypair.json
anchor keys sync
anchor build
```

`anchor keys sync` обновит `declare_id!` в `lib.rs` и адрес программы в `Anchor.toml`. Keypair программы не добавляйте в Git. Это не кошелёк администратора.

Указанный ниже devnet ID уже развернут. Файл program keypair намеренно не хранится в репозитории. Если вы создадите собственный keypair и запустите `anchor keys sync`, получится новый program ID для вашего отдельного деплоя.

### 5. Настройте кошелёк администратора в devnet

Если у вас уже есть Solana keypair, используйте его. Если нет, создайте новый в Ubuntu; сохраните файл в безопасном месте и не отправляйте его никому:

```bash
solana-keygen new
```

Установите devnet как текущий кластер и проверьте, что настроен правильный публичный адрес:

```bash
solana config set --url devnet
solana config get
solana address
solana balance
```

Для учебного деплоя нужен тестовый SOL. Попробуйте получить его:

```bash
solana airdrop 2
```

Если faucet ограничил запросы, используйте [Solana Devnet Faucet](https://faucet.solana.com/). Для devnet используйте только тестовые SOL.

### 6. Задеплойте и создайте аккаунты

```bash
anchor deploy --provider.cluster devnet
yarn setup:devnet
```

Для прямого запуска скрипта задайте RPC и путь к кошельку, иначе Anchor не сможет создать provider из переменных окружения:

```bash
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET="$HOME/.config/solana/id.json" \
yarn setup:devnet
```

Скрипт создаст тестовый SPL mint с 6 decimals, затем vault и карточку администратора. В конце он напечатает адреса аккаунтов и Explorer-ссылки. Чтобы использовать существующий mint, передайте его адрес: `yarn setup:devnet <TOKEN_MINT_ADDRESS>`; mint должен уже существовать в devnet.

Для открытия карточки другого кошелька вызовите `createUserCard` с подписью этого пользователя, PDA `vault_state` и PDA-карточки по seeds выше. Пользователь оплачивает создание собственной карточки.

## Devnet-деплой и аккаунты

Программа успешно собрана и развернута в Solana devnet. Проверка через Solana RPC подтвердила program account и все четыре аккаунта vault.

| Объект | Адрес | Explorer |
|---|---|---|
| Программа Liquidity Vault | `7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S` | [Открыть программу](https://explorer.solana.com/address/7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S?cluster=devnet) |
| Кошелёк администратора / authority программы | `A4LCC3q4PZt3orzGqowwMyJE23Xb5hxg1aizq3DRpucj` | [Открыть кошелёк](https://explorer.solana.com/address/A4LCC3q4PZt3orzGqowwMyJE23Xb5hxg1aizq3DRpucj?cluster=devnet) |
| Тестовый mint принимаемого SPL-токена | `3ZF2ErKWGGpZAK4HEWPTgk4kxF95avg5qEKSZS8R7fVm` | [Открыть mint](https://explorer.solana.com/address/3ZF2ErKWGGpZAK4HEWPTgk4kxF95avg5qEKSZS8R7fVm?cluster=devnet) |
| `VaultState` PDA | `5tTHydct51S4mUeP3YHfgVkvv58fVQFQ2gxkbKGMmob6` | [Открыть настройки vault](https://explorer.solana.com/address/5tTHydct51S4mUeP3YHfgVkvv58fVQFQ2gxkbKGMmob6?cluster=devnet) |
| Token custody PDA | `EQuEpnsP7Ld6tcbrG46ViJ5pMMA76fLnvNvZyyqTLxqp` | [Открыть хранилище](https://explorer.solana.com/address/EQuEpnsP7Ld6tcbrG46ViJ5pMMA76fLnvNvZyyqTLxqp?cluster=devnet) |
| Share mint PDA | `FxNGzH6bM7u2nNSwR2vMYhhG72wJRQ9DwpCm3kiLpgAp` | [Открыть share mint](https://explorer.solana.com/address/FxNGzH6bM7u2nNSwR2vMYhhG72wJRQ9DwpCm3kiLpgAp?cluster=devnet) |
| Карточка пользователя `UserCard` PDA | `4o6tfffq4AFVLXQ5sEMnh9HHeDXmVM83QcSns6hAw8h9` | [Открыть карточку](https://explorer.solana.com/address/4o6tfffq4AFVLXQ5sEMnh9HHeDXmVM83QcSns6hAw8h9?cluster=devnet) |

Транзакции: [деплой программы](https://explorer.solana.com/tx/4Ln7FxDEatQRpbi1yMMvyLeq3Dhrk5cRZk3xN4qT84iH4mL8Q9vQRsZqUcf6AuJu5jbzEVg7Cxd5bTs4Sy9Es8yy?cluster=devnet), [создание vault](https://explorer.solana.com/tx/3mAmGZX9sm7WBQXcC8xWLKQpWGisQakc4JYWk1VSyCxNcGMC55Sw7nfe8oeUMb5fADMAtpf2e3LmBFXCUropns3M?cluster=devnet), [создание карточки](https://explorer.solana.com/tx/363a1iB1H72Rpc3EFtakYSxrYrfc3fSD7kBpkwRHdZfMRJn4L3vGzv8urtZVHG8DBgNjKQDjW2B3NPEMduxrMdwk?cluster=devnet).

Приватные ключи кошелька и программы в репозитории не хранятся. Они остаются в локальной конфигурации WSL.

## Официальные инструкции

- [Установка Solana CLI и Anchor CLI, включая Windows/WSL](https://solana.com/docs/intro/installation)
- [Установка отдельных зависимостей Solana](https://solana.com/docs/intro/installation/dependencies)
- [Основы Solana CLI: конфигурация сети и кошелёк](https://solana.com/docs/intro/installation/solana-cli-basics)
- [Anchor Version Manager](https://www.anchor-lang.com/docs/installation)

## Что объяснить на защите

- Share mint создаётся с `VaultState` PDA в качестве mint authority: позже программа сможет выпускать квитанции по правилам протокола, а администратор не сможет единолично подделать их.
- PDA вычисляется из seeds и program ID; это адрес без приватного ключа. Программа может подписывать от имени PDA через seeds при CPI.
- Адрес карточки находится повторным вычислением PDA из `vault_state` и публичного ключа пользователя.
- Настройки, токен-хранилище и share mint создаются однократно для каждого mint принимаемого токена. Карточка создаётся отдельно каждым пользователем.
