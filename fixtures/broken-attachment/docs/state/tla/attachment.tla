---- MODULE Attachment ----
VARIABLES phase, wroteWhileClosed

vars == <<phase, wroteWhileClosed>>

Init == phase = "Open" /\ wroteWhileClosed = FALSE

Close ==
    /\ phase = "Open"
    /\ phase' = "Closed"
    /\ UNCHANGED wroteWhileClosed

Write ==
    /\ wroteWhileClosed' = (phase = "Closed")
    /\ UNCHANGED phase

Done ==
    /\ phase = "Closed"
    /\ UNCHANGED vars

Next == Close \/ Write \/ Done

NoWriteAfterClose == wroteWhileClosed = FALSE
OnlyOpenOrClosed == phase \in {"Open", "Closed"}

Spec == Init /\ [][Next]_vars
====
