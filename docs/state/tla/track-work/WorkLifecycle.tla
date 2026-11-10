---- MODULE WorkLifecycle ----
\* One page with two tasks, replayed the way server/work.ts replays records.
\* A task moves only by an allowed event. The page follows its tasks; its own
\* records only accept, drop or verify it. "verified" holds only while the
\* saved rule check names the commit the page is stamped with.
EXTENDS Naturals

Tasks == {"t1", "t2"}
Finished == {"implemented", "verified", "dropped"}

VARIABLES own, task, merged, verifiedRecord, stamp, checked

vars == <<own, task, merged, verifiedRecord, stamp, checked>>

\* followTasks in server/work.ts.
Live == {t \in Tasks : task[t] /= "dropped"}
Follow ==
    IF own \in {"draft", "dropped"} THEN own
    ELSE IF Live = {} THEN "dropped"
    ELSE IF \A t \in Live : task[t] \in {"implemented", "verified"} THEN
        IF verifiedRecord /\ stamp /= 0 /\ checked = stamp THEN "verified" ELSE "implemented"
    ELSE IF \E t \in Live : task[t] = "blocked" THEN "blocked"
    ELSE IF \A t \in Live : task[t] \in {"review", "implemented", "verified"} THEN "review"
    ELSE IF \A t \in Live : task[t] \in {"planned", "draft"} THEN "planned"
    ELSE "working"

Init ==
    /\ own = "draft"
    /\ task = [t \in Tasks |-> "draft"]
    /\ merged = [t \in Tasks |-> FALSE]
    /\ verifiedRecord = FALSE
    /\ stamp = 0
    /\ checked = 0

\* A task's own move: allowed only from its listed state, and never after the page is dropped.
Move(t, from, to) ==
    /\ Follow /= "dropped"
    /\ task[t] \in from
    /\ task' = [task EXCEPT ![t] = to]
    /\ verifiedRecord' = FALSE

Accept ==
    /\ own = "draft"
    /\ own' = "planned"
    /\ task' = [t \in Tasks |-> IF task[t] = "draft" THEN "planned" ELSE task[t]]
    /\ UNCHANGED <<merged, verifiedRecord, stamp, checked>>

Start(t) == Move(t, {"planned"}, "working") /\ UNCHANGED <<own, merged, stamp, checked>>
Ask(t) == Move(t, {"working"}, "blocked") /\ UNCHANGED <<own, merged, stamp, checked>>
Answer(t) == Move(t, {"blocked"}, "working") /\ UNCHANGED <<own, merged, stamp, checked>>
Submit(t) == Move(t, {"working"}, "review") /\ UNCHANGED <<own, merged, stamp, checked>>
Rework(t) == Move(t, {"review"}, "working") /\ UNCHANGED <<own, merged, stamp, checked>>
\* merge needs a commit: the record names the commit that landed it.
Merge(t) == Move(t, {"review"}, "implemented") /\ merged' = [merged EXCEPT ![t] = TRUE] /\ UNCHANGED <<own, stamp, checked>>
Reopen(t) == Move(t, {"implemented", "verified"}, "working") /\ UNCHANGED <<own, merged, stamp, checked>>
DropTask(t) == Move(t, {"draft", "planned", "working", "review"}, "dropped") /\ UNCHANGED <<own, merged, stamp, checked>>

DropPage ==
    /\ Follow \in {"draft", "planned", "working", "review"}
    /\ own' = "dropped"
    /\ UNCHANGED <<task, merged, verifiedRecord, stamp, checked>>

\* The page is stamped with a newer sourceRevision (bounded to two stamps).
Stamp ==
    /\ stamp < 2
    /\ stamp' = stamp + 1
    /\ UNCHANGED <<own, task, merged, verifiedRecord, checked>>

\* check_model saves a result naming the page's current stamp.
Check ==
    /\ stamp /= 0
    /\ checked' = stamp
    /\ UNCHANGED <<own, task, merged, verifiedRecord, stamp>>

\* verify needs a fresh check that names the page's stamp.
Verify ==
    /\ Follow = "implemented"
    /\ stamp /= 0 /\ checked = stamp
    /\ verifiedRecord' = TRUE
    /\ UNCHANGED <<own, task, merged, stamp, checked>>

Next ==
    \/ Accept \/ DropPage \/ Stamp \/ Check \/ Verify
    \/ \E t \in Tasks : Start(t) \/ Ask(t) \/ Answer(t) \/ Submit(t) \/ Rework(t) \/ Merge(t) \/ Reopen(t) \/ DropTask(t)

TypeOK ==
    /\ own \in {"draft", "planned", "dropped"}
    /\ task \in [Tasks -> {"draft", "planned", "working", "blocked", "review", "implemented", "verified", "dropped"}]

\* The page is never finished while one of its tasks is still open.
NeverFinishedWithOpenTask == Follow \in {"implemented", "verified"} => \A t \in Tasks : task[t] \in Finished

\* Nothing reaches implemented without a commit.
ImplementedHasCommit == \A t \in Tasks : task[t] = "implemented" => merged[t]

\* Verified always names the same commit as the page stamp.
VerifiedNamesStamp == Follow = "verified" => (stamp /= 0 /\ checked = stamp)

\* No task is worked on before the person accepts the plan. A task may be dropped from the draft.
NoWorkBeforeAccept == own = "draft" => \A t \in Tasks : task[t] \in {"draft", "dropped"}

Spec == Init /\ [][Next]_vars
====
