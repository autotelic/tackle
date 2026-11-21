# The three services, as they stand

```sh
# one shop on this machine
board up --detach --port 4780
curl -s localhost:4780/presence | jq

# one room with a process it owns
room new --repo ~/code/app --scope dev-1575
room up --id dev-1575 --exec 'pnpm dev'
room pause --id dev-1575
room resume --id dev-1575
room down --id dev-1575

# the mailbox
mailbox-server serve --port 4781 --state .mailbox/state.json
```

|         | durable                     | process control            | HTTP                    |
| ------- | --------------------------- | -------------------------- | ----------------------- |
| room    | `room.json` + worktree      | supervisor + process group | no                      |
| board   | `shop.lock`                 | not yet (library only)     | health, presence, queue |
| mailbox | `state.json`, atomic writes | no                         | six XRPC routes         |

All three bind loopback and have no authentication. Mailbox sender identity and
federation are the next security boundary; board-to-room supervision and a real
`room move` are the next functional ones.
