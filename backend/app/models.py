"""Import every model module so Base.metadata is complete (Alembic, tests)."""

from app.admin import models as admin_models  # noqa: F401
from app.audit import models as audit_models  # noqa: F401
from app.auth import models as auth_models  # noqa: F401
from app.core.db import Base
from app.correspondence import models as correspondence_models  # noqa: F401
from app.entitlement import models as entitlement_models  # noqa: F401
from app.finance import models as finance_models  # noqa: F401
from app.leads import models as leads_models  # noqa: F401
from app.members import models as members_models  # noqa: F401
from app.reservations import models as reservations_models  # noqa: F401

metadata = Base.metadata
