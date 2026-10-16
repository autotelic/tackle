# Types over logic

A rule for a habit this repository keeps having: a problem is chased down by
**adding logic** -- another `if`, another `typeof`, another null check -- where
refining a type (a brand, a refined schema, a non-nullable type parsed once) would
make the check unnecessary and the class of bug impossible. `parse, don't
validate`, as a finding rather than a principle.

## The rule

`joggle/types-over-logic`.

**Deterministic half (the shape).** A function guards a value with a guard clause
-- `if (!x)`, `if (x === null)`, `if (typeof x !== "...")` -- that returns or
throws, and it declared that value as a **wide** type: a bare primitive
(`string`, `number`, `boolean`, `object`, `unknown`, `any`) or a nullable. The
guard and the declaration are both read from the function's own source, since the
facts carry the source and not per-parameter types.

**Judged half (the question).**

- `type_should_carry_it` -- parse the value once at the boundary into a narrower
  type, so this check and every later one like it disappears.
- `boundary_check` -- the function IS the boundary: it turns untrusted input (a
  raw or unparsed argument, network data, a schema decode) into a typed value, so
  the check is the type being established.
- `runtime_condition` -- the guard tests state a type cannot hold (a flag, a
  network result, a value looked up at run time).

## Tuning it taught its own lesson

The first question declined **all 98** candidates on shakti-v2 (median 0.25), and
the reason was in the candidates:

```ts
export function classifyWorkType(role: ProjectRole | null): WorkType {
  if (role === null) return 'other'      // the nullability belongs in the caller's type
  return WORK_TYPE_MAP[role]
}
```

The model was reading "takes a value, handles its null case" as a boundary. The
criteria now say a boundary is a function whose **own job** is to turn untrusted
input into a typed value, and that a parameter typed `T | null`,
`string | number` or `unknown` that the guard narrows is the common shape of the
problem. Weak -> decisive, median 0.70, **41 acted**.

## The measurement

41 findings on shakti-v2, every one a wide-typed value guarded rather than
narrowed. A sample:

```
budget.ts        applyBudgetAdjustment guards `adjustment` (`BudgetAdjustment | null`)
work-type.ts     classifyWorkType guards `role` (`ProjectRole | null`)
queries.ts       getUserSupervisorId guards `userId` (`string | null`)
queries.ts       encryptField guards `value` (`string | undefined`)
domain.ts        resolveProductionActual guards `calculationKey` (`string | null`)
```

The `T | null` parameter is the dominant shape, which is the same shape as the
payroll bug (`docs/type-resolution.md`): a value that can be absent, handled at
each use site instead of once in the type.

## Why it is a question and not a prohibition

A null check is not wrong. It is wrong *in a place where a type could have made it
unnecessary*, and only a reader can tell the two apart -- the same distinction the
whole design rests on. The rule supplies the shape (a guard on a wide type) and
asks which it is; it never forbids the check.
