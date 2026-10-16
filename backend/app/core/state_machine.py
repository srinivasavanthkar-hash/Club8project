"""Tiny generic state machine used by leads, members and reservations.

Transitions are data (seeded into `status_transitions` master data per entity) so they
are configurable; the defaults below are the seed values and the test oracle.
"""

from collections.abc import Iterable, Mapping

from app.core.errors import RuleViolation


class StateMachine:
    def __init__(self, entity: str, transitions: Mapping[str, Iterable[str]]) -> None:
        self.entity = entity
        self.transitions = {k: frozenset(v) for k, v in transitions.items()}

    def allowed(self, current: str) -> frozenset[str]:
        return self.transitions.get(current, frozenset())

    def check(self, current: str, target: str) -> None:
        if target not in self.allowed(current):
            raise RuleViolation(
                f"{self.entity}: transition {current} -> {target} is not allowed",
                code="InvalidTransition",
                extra={"from": current, "to": target, "allowed": sorted(self.allowed(current))},
            )


LEAD_TRANSITIONS: dict[str, list[str]] = {
    "NEW": ["CONTACTED", "NOT_INTERESTED"],
    "CONTACTED": ["PRESENTATION_SCHEDULED", "NOT_INTERESTED"],
    "PRESENTATION_SCHEDULED": ["ATTENDED", "PRESENTATION_SCHEDULED", "NOT_INTERESTED", "CONTACTED"],
    "ATTENDED": ["CONVERTED", "NOT_INTERESTED"],
    "NOT_INTERESTED": ["CONTACTED"],
    "CONVERTED": [],
}

MEMBER_TRANSITIONS: dict[str, list[str]] = {
    "PENDING_APPROVAL": ["ACTIVE"],
    "ACTIVE": ["DEFAULT_NOTICE", "SUSPENDED", "EXPIRED"],
    "DEFAULT_NOTICE": ["ACTIVE", "TERMINATED"],
    "SUSPENDED": ["ACTIVE", "TERMINATED"],
    "EXPIRED": [],
    "TERMINATED": [],
}

RESERVATION_TRANSITIONS: dict[str, list[str]] = {
    "REQUESTED": ["APPROVED", "DECLINED", "CANCELLED", "RESCHEDULED"],
    "APPROVED": ["CONFIRMED", "DECLINED", "CANCELLED", "RESCHEDULED"],
    "CONFIRMED": ["CANCELLED", "RESCHEDULED"],
    # RESCHEDULED = new dates recorded, awaiting (re)approval/confirmation of the revised stay
    "RESCHEDULED": ["APPROVED", "CONFIRMED", "DECLINED", "CANCELLED", "RESCHEDULED"],
    "DECLINED": [],
    "CANCELLED": [],
}

lead_sm = StateMachine("Lead", LEAD_TRANSITIONS)
member_sm = StateMachine("Member", MEMBER_TRANSITIONS)
reservation_sm = StateMachine("Reservation", RESERVATION_TRANSITIONS)
