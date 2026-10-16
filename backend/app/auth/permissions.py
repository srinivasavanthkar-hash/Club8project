"""Permission catalogue (seeded). Management assigns them to roles in the admin screen."""

PERMISSIONS: dict[str, str] = {
    # leads
    "lead.view": "View leads",
    "lead.create": "Create leads",
    "lead.update": "Edit leads",
    "lead.status.change": "Change lead status",
    "lead.convert": "Convert lead to member",
    "lead.duplicate_override": "Save despite probable duplicate",
    # members
    "member.view": "View members",
    "member.create": "Create members",
    "member.update": "Edit members",
    "member.approve": "Approve members",
    "member.status.change": "Change member status",
    "member.terminate": "Terminate memberships",
    "member.duplicate_override": "Save member despite duplicate",
    "kyc.view_full": "View full KYC numbers and download KYC documents",
    # finance
    "finance.view": "View finance",
    "payment.create": "Record payments",
    "payment.correct": "Correct payments",
    "schedule.manage": "Generate / edit EMI schedules",
    "finance.default_notice": "Issue default notices",
    # reservations / entitlement
    "reservation.view": "View reservations",
    "reservation.create": "Create reservations",
    "reservation.update": "Edit reservations",
    "reservation.status.change": "Change reservation status",
    "reservation.override": "Override reservation rules",
    "entitlement.view": "View entitlement",
    "entitlement.adjust": "Manual entitlement adjustment",
    # correspondence
    "correspondence.view": "View correspondence",
    "correspondence.create": "Add emails / calls",
    "document.upload": "Upload documents",
    "document.view": "View / download documents",
    "document.delete": "Soft-delete documents",
    "letter.generate": "Generate letters",
    # admin
    "auditlog.view": "View activity log",
    "auditlog.verify": "Verify activity log integrity",
    "export.run": "Run exports",
    "admin.users": "Manage users",
    "admin.roles": "Manage roles and permissions",
    "admin.masterdata": "Manage master data",
    "admin.rates": "Manage rate tables (ASF, tax, matrix, tiers)",
    "admin.rates.override_cap": "Save ASF revision above the agreement cap",
    "admin.templates": "Manage letter templates",
    "admin.customfields": "Manage custom fields",
}

_ALL = set(PERMISSIONS)
_VIEW = {
    "lead.view",
    "member.view",
    "finance.view",
    "reservation.view",
    "entitlement.view",
    "correspondence.view",
    "document.view",
}

ROLE_DEFAULTS: dict[str, tuple[str, set[str]]] = {
    "ADMIN": ("Administrator", _ALL),
    "MANAGEMENT": ("Management", _ALL - {"admin.users"}),
    "MARKETING": (
        "Marketing",
        {"lead.view", "lead.create", "lead.update", "lead.status.change", "lead.duplicate_override"},
    ),
    "SALES": (
        "Sales",
        _VIEW
        | {
            "lead.duplicate_override",
            "lead.create",
            "lead.update",
            "lead.status.change",
            "lead.convert",
            "member.create",
            "member.update",
            "document.upload",
            "correspondence.create",
        },
    ),
    "FINANCE": (
        "Finance",
        _VIEW
        | {
            "payment.create",
            "payment.correct",
            "schedule.manage",
            "finance.default_notice",
            "document.upload",
            "correspondence.create",
            "letter.generate",
            "export.run",
        },
    ),
    "RESERVATIONS": (
        "Reservations",
        _VIEW
        | {
            "reservation.create",
            "reservation.update",
            "reservation.status.change",
            "document.upload",
            "correspondence.create",
            "letter.generate",
        },
    ),
    "MEMBER_SERVICES": (
        "Member services",
        _VIEW | {"member.update", "correspondence.create", "document.upload", "reservation.create"},
    ),
}
