# The Schedule is computed on the client from the clock

Every viewer must see the same Clip at the same moment, like broadcast TV. Rather than a server that tracks "what's on now", each client derives it deterministically from the manifest and the current time: `position = (now − epoch) mod cycleLength`, with each Cycle's order produced by a shuffle seeded from the Cycle number (and a swap so a Clip never airs twice across a Cycle boundary). This keeps v1 free of server state. Client clock skew is corrected using the `Date` header of the manifest response.

## Consequences

- Any change to the Library (adding or removing Clips) reshuffles the Schedule, so viewers jump to a different Clip. Clients refetch the manifest at each Clip boundary so all viewers converge within one Clip.
- The Schedule algorithm lives in shared code and must stay identical between the frontend and anything else that computes it; changing it changes what airs.
