# ADR 0005 — a federated factory floor: machines, services, and candidate VMs

Status: proposed  
Date: 2026-11-26

## Context

The factory is becoming a set of machines, not one host. A peer may run an older revision;
its factory should still be visible and usable. Each workstream may run several isolated
environments (candidate VMs), each with its own services and ports. The floor needs to answer,
in one place: which machine, which workstream, which candidate, which services, what health, and
which link opens the app.

Credentials are already local to the machine that holds them. The executor lease is the
cross-machine unit; raw secrets must not travel in a workstream record, a PR, or a peer request.

## Decisions

### Identity is a tuple, not a hostname per service

```text
machine      tailnet node (MagicDNS name + stable node id)
workstream   factory record id
candidate    one isolated head/VM of a workstream
service      candidate + declared service name
```

Do not mint a DNS name per service. The machine has a tailnet DNS name; the service is a
port/path on that machine. A stable board route (`/preview/<workstream>/<service>`) is the
reader's link, and it resolves the current lease at request time, as the existing preview route
already does for a host port.

### Each machine owns a local registry

```text
board /presence
  factory.workstreams[]
  factory.environments[]
    machine { host, dnsName, version }
    workstream
    candidate { id, head, runtime, state }
    services [{ name, port, health, preview }]
    agent { session, status }
```

A peer reads another machine's `/presence` over the tailnet. Aggregation is a read, not a write:
the local record stays authoritative on the machine that runs the work. A missing peer is
shown as `unreachable`, never as empty/healthy.

### Ports are leased twice

The VM owns its service port. The host owns a proxy port from the room's existing lease range.
The proxy forwards to the VM's loopback service and is the only listener bound on the tailnet
interface. The VM port is never published directly. Health is observed through the same proxy.

No custom DNS is needed for the first slice. MagicDNS gives the machine; the board path gives
the service. Tailscale Serve can add TLS later without changing the identity tuple.

### Credentials cross as leases

A peer asks its own executor for a capability. The local executor resolves a repository
manifest and mints a short-lived lease, as `factory executor lease` already does. A remote
request carries the lease or a request for one; it never carries the stored account. The peer
identity is the tailnet node, and a lease is scoped to one workstream/candidate.

### Candidates are workstreams with a head, not a second record type

A candidate is the existing workstream record plus:

```text
candidate: { id, head, vm: { id, state }, gates: [...] }
```

A workstream may have one active candidate and N archived candidates. The floor groups them
under the workstream. Evaluation compares gate receipts and a bounded diff; the human still
owns the merge.

## First slices

1. Extend `/presence` with `factory.environments` for local workstreams (already planned in
   `docs/environment-plan.md`).
2. Add a room service registry: `services[]` with name, VM port, host proxy port, health path.
   Observe health through the proxy, not the VM directly.
3. Add peer `/presence` reads with tailnet identity and an `unreachable` state.
4. Add candidate grouping to the floor, starting with two VMs of the same workstream.
5. Add remote executor lease requesting; keep the raw store local.

## Consequences

- A remote factory can be visible and useful before it can be controlled.
- The floor can show an isolated preview without inventing a per-service DNS zone.
- Credentials remain least-privilege and per-machine; federation is a lease exchange.
- Cross-machine dispatch, automatic failure handoff, and multi-service routing remain later
  slices; this record does not claim them.
