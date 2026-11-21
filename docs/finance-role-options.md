# The finance/dispatcher/ops role split: what exists today, and the options

For the owner and team to decide together. Written 17 Oct 2026. Nothing here has been built yet.

## What actually happens today (confirmed by reading the code, not guessed)

A person added to a logistic company can be given one of seven roles: **owner, admin, ops, finance,
dispatcher, driver, member**. The invite and "change role" screens already offer all seven - picking
"Operations" or "Dispatcher" works fine today.

The problem is what happens *after* that pick. One line of code
(`backend-ts/src/core/org-context.ts:116`) turns those seven into four permission levels:

| You pick... | What the system actually treats you as |
|---|---|
| Owner / Admin | **admin** - full access |
| Finance | **finance** - its own level (see below) |
| Driver | **driver** - the driver app only |
| Ops, Dispatcher, or Member | **manager** - all three are identical |

So **"Ops" and "Dispatcher" are not broken, they just don't exist yet as real permission levels.**
Someone given either role today sees exactly what a plain "Member" sees - the day-to-day operations
menu (Today, Requests, Dispatch, On the road, Fleet, People) and nothing under Money. There is no
code bug here, no half-finished logic - the distinction was simply never built past the dropdown.

**Finance** already *is* a real, separate level. Anyone marked "Finance" sees only the Money section
(pricing, invoices, driver pay, expenses, claims, analytics) and nothing else - no Dispatch, no Fleet,
no People, no Settings. That part works exactly as intended.

## Why this might matter to you

If every company only ever uses Admin, Finance, and Driver, none of this matters - the system already
does the right thing. It only becomes a real gap if a company wants to hand someone the "Dispatcher"
or "Ops" label specifically *because* they expect it to mean something narrower than full manager
access (e.g. "can see and work the dispatch board, but should not be able to see People or change
Fleet settings"). Today, giving someone that label doesn't actually narrow anything - they get the
same access as everyone else lumped into "manager".

## Three ways forward

**1. Leave it as it is.**
No work, no risk. "Ops" and "Dispatcher" stay cosmetic labels on top of the same manager access.
Fine if no company has actually asked for narrower roles yet.

**2. Give Finance real teeth, not just visibility.**
Right now Finance can only *see* Money - type a price, approve an invoice, enter driver pay. Asking
them to also *decide* things (approve a price before it's final, approve a payout) would mean adding
new, real approval steps to those screens that don't exist today for anyone - this is new functionality,
not a permission change.

**3. Build "Ops" and "Dispatcher" as their own levels.**
Give each a real, narrower slice of the current "manager" access - e.g. Dispatcher can work the
dispatch board and fleet but not see People; Ops can see everything operational but not change Fleet
settings. This needs someone to decide exactly what each should and shouldn't touch before any code
is written - that's a product decision, not something to guess at from the database.

## What we'd need from you to build option 2 or 3

For each role you want to be real: a plain list of "can do" and "cannot do" - which of Today, Requests,
Dispatch, On the road, Fleet, People, Money, Settings they should see, and whether seeing a screen
also means being able to change things on it or only look. Once that list exists, the work itself is
small and low-risk - it is the same one-line mapping (`appRoleFor`) that already handles Admin,
Finance and Driver correctly today; adding a role means adding one clear branch to it, not rebuilding
anything.
