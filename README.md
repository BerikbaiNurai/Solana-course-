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

`anchor build` собрал программу и IDL. Деплой программы и депозит в devnet завершились успешно; обе транзакции получили статус Finalized. Внесли 1 тестовый токен (mint с 6 decimals), пользователь получил 1 share-токен.

## Аккаунты и транзакции в Devnet

Неделя 9 развернута поверх версии недели 8 с теми же program ID и аккаунтами.

| Объект | Адрес и Explorer |
|---|---|
| Программа Liquidity Vault | [7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S](https://explorer.solana.com/address/7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S?cluster=devnet) |
| ProgramData | [HfuTjgLcVD52kqtwUWWzHbkrWVfKxBAEE7o5TBELb1Yh](https://explorer.solana.com/address/HfuTjgLcVD52kqtwUWWzHbkrWVfKxBAEE7o5TBELb1Yh?cluster=devnet) |
| Mint тестового токена | [3ZF2ErKWGGpZAK4HEWPTgk4kxF95avg5qEKSZS8R7fVm](https://explorer.solana.com/address/3ZF2ErKWGGpZAK4HEWPTgk4kxF95avg5qEKSZS8R7fVm?cluster=devnet) |
| `VaultState` | [5tTHydct51S4mUeP3YHfgVkvv58fVQFQ2gxkbKGMmob6](https://explorer.solana.com/address/5tTHydct51S4mUeP3YHfgVkvv58fVQFQ2gxkbKGMmob6?cluster=devnet) |
| Token account vault | [EQuEpnsP7Ld6tcbrG46ViJ5pMMA76fLnvNvZyyqTLxqp](https://explorer.solana.com/address/EQuEpnsP7Ld6tcbrG46ViJ5pMMA76fLnvNvZyyqTLxqp?cluster=devnet) |
| Share mint | [FxNGzH6bM7u2nNSwR2vMYhhG72wJRQ9DwpCm3kiLpgAp](https://explorer.solana.com/address/FxNGzH6bM7u2nNSwR2vMYhhG72wJRQ9DwpCm3kiLpgAp?cluster=devnet) |
| Карточка пользователя | [4o6tfffq4AFVLXQ5sEMnh9HHeDXmVM83QcSns6hAw8h9](https://explorer.solana.com/address/4o6tfffq4AFVLXQ5sEMnh9HHeDXmVM83QcSns6hAw8h9?cluster=devnet) |
| Token account пользователя | [4etSxC5m9xjRDuk7jmxC1eqwayHdFByQf3jowfZCJBPs](https://explorer.solana.com/address/4etSxC5m9xjRDuk7jmxC1eqwayHdFByQf3jowfZCJBPs?cluster=devnet) |
| Share account пользователя | [82Ed4Q5ncmW1LWKjMWH7yEHNLvDhS8ZDKZVYt1SXH9dK](https://explorer.solana.com/address/82Ed4Q5ncmW1LWKjMWH7yEHNLvDhS8ZDKZVYt1SXH9dK?cluster=devnet) |

- [Транзакция деплоя week-9](https://explorer.solana.com/tx/4RyQuFVfRh2BJFaBGiL4iS3oPPzya4YYBXLiLDXbEscEq3THrLsABrdAUFtGx46FrEc2D4hixLULdP17VMptDuhu?cluster=devnet), слот 520326963.
- [Депозит 1 тестового токена и выпуск 1 share-токена](https://explorer.solana.com/tx/2acZRqaqJgYiX3zndDSUhKBs22UeSinMoJBktppYXzo6bMPoWD7sZCJFo1MKdDDB2pgGutWsbLhRsmAU1Vtpqvw2?cluster=devnet).

## Что мы поняли

- Пользователь подписывает перевод токенов, а PDA vault подписывает выпуск shares.
- Количество shares зависит от того, сколько токенов уже находится в vault и сколько shares уже выпущено.
- Карточка и share account нужны для разных задач: карточка хранит сумму депозитов, share account хранит сами токены-квитанции.
- Проверки mint и authority не дают подменить token account или получить shares на чужой кошелёк.
