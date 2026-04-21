from datetime import datetime
import math

# ── Constants ─────────────────────────────────────────────
ROLES = ["TECHNICIAN", "PROJECT_MANAGER", "HR", "DIRECTION", "ADMIN"]

PERMISSIONS = {
    "TECHNICIAN": [
        "CLOCK_IN",
        "TAKE_PHOTO",
        "VIEW_OWN_TIMESHEETS"
    ],
    "PROJECT_MANAGER": [
        "TAKE_PHOTO",
        "DELETE_PHOTO",
        "MANAGE_PROJECTS",
        "MANAGE_TEAM",
        "MANAGE_SITE",
        "VIEW_ATTENDANCE"
    ],
    "HR": [
        "TAKE_PHOTO",
        "VIEW_HR_HOURS",
        "EXPORT_DATA"
    ],
    "DIRECTION": [
        "TAKE_PHOTO",
        "DELETE_PHOTO",
        "MANAGE_PROJECTS",
        "MANAGE_TEAM",
        "MANAGE_SITE",
        "VIEW_ATTENDANCE",
        "VIEW_HR_HOURS",
        "EXPORT_DATA",
        "VIEW_DELETION_LOGS"
    ],
    "ADMIN": ["*"],
}

EXCLUSION_PERMISSIONS   = {"ADMIN": ["CLOCK_IN"]}
CLOCK_IN_TYPES          = ["ARRIVAL", "DEPARTURE", "INTERMEDIATE"]
CLOCK_IN_STATUSES       = ["VALID", "REJECTED"]
PROJECT_STATUSES        = ["IN_PROGRESS", "COMPLETED", "ON_HOLD", "ARCHIVED"]
SITE_STATUSES           = ["ACTIVE", "COMPLETED", "ON_HOLD"]
TEAM_STATUSES           = ["ACTIVE", "INACTIVE"]
TEAM_ROLES              = ["TEAM_LEAD", "MEMBER"]
TEAM_MEMBER_STATUSES    = ["ACTIVE", "INACTIVE"]
PHOTO_CATEGORIES        = ["PROGRESS", "INCIDENT", "OTHER"]


# ── USER ──────────────────────────────────────────────────
class User:

    def __init__(self, id, last_name, first_name, password, role, contact, is_active=True):
        self.id         = id
        self.last_name  = last_name
        self.first_name = first_name
        self.password   = password
        self.role       = role
        self.contact    = contact
        self.is_active  = is_active

    def can(self, action):
        if self.role not in PERMISSIONS:
            return False
        perms = PERMISSIONS[self.role]
        if "*" in perms:
            excluded = EXCLUSION_PERMISSIONS.get(self.role, [])
            return action not in excluded
        return action in perms

    def update_profile(self, **kwargs):
        for key, value in kwargs.items():
            if key in ['last_name', 'first_name', 'contact', 'password']:
                setattr(self, key, value)

    def deactivate_account(self, admin_user):
        if admin_user.role != "ADMIN":
            raise Exception("Action restricted to administrators")
        self.is_active = False

    def clock_in(self, site, clock_in_type, lat, lng):
        if not self.is_active:
            raise Exception("User account is inactive")
        if not self.can("CLOCK_IN"):
            raise Exception("Permission denied: this user cannot clock in")
        if not site.is_active():
            raise Exception("This site is not active")

        if clock_in_type == "ARRIVAL":
            if site.has_open_session(self):
                raise Exception("A session is already open on this site")

        if clock_in_type == "DEPARTURE":
            if not site.has_open_session(self):
                raise Exception("No arrival recorded to close")

        distance = site.verify_clock_in(self, lat, lng)
        if distance > 2.0:
            raise Exception(f"Clock-in rejected: you are {distance:.2f} km away from the site")

        record = ClockInRecord(
            site              = site,
            user              = self,
            clock_in_type     = clock_in_type,
            latitude          = lat,
            longitude         = lng,
            distance_to_site  = distance
        )
        return record

    def take_photo(self, site, filename, category=None):
        if not self.is_active:
            raise Exception("User account is inactive")
        if not self.can("TAKE_PHOTO"):
            raise Exception("Permission denied")
        if not site.is_active():
            raise Exception("This site is not active")

        photo = Photo(
            site     = site,
            user     = self,
            filename = filename,
            category = category
        )
        return photo

    def get_clock_in_history(self, site):
        if not self.can("VIEW_OWN_TIMESHEETS"):
            raise Exception("Permission denied")
        return [r for r in site.get_clock_in_records() if r.user.id == self.id]

    def export_data(self, site, month, year):
        if not self.can("EXPORT_DATA"):
            raise Exception("Permission denied")

        monthly_records = [
            r for r in site.get_clock_in_records()
            if r.clock_in_date.startswith(f"{year}-{month:02d}")
        ]

        rows = []
        for r in monthly_records:
            rows.append({
                "employee"        : f"{r.user.first_name} {r.user.last_name}",
                "type"            : r.clock_in_type,
                "date"            : r.clock_in_date,
                "time"            : r.clock_in_time,
                "status"          : r.status,
                "distance_km"     : r.distance_to_site
            })
        return rows  # Phase 3 → real CSV/Excel file

    def __repr__(self):
        return f"User({self.first_name} {self.last_name} | {self.role})"


# ── CLOCK-IN RECORD ───────────────────────────────────────
class ClockInRecord:

    def __init__(self, site, user, clock_in_type, latitude, longitude, distance_to_site):

        if clock_in_type not in CLOCK_IN_TYPES:
            raise Exception(f"Invalid clock-in type: {clock_in_type}")

        self.site             = site
        self.user             = user
        self.clock_in_type    = clock_in_type
        self.latitude         = latitude
        self.longitude        = longitude
        self.distance_to_site = distance_to_site
        self.clock_in_date    = datetime.now().strftime("%Y-%m-%d")
        self.clock_in_time    = datetime.now().strftime("%H:%M:%S")
        self.status           = "VALID" if distance_to_site <= 2.0 else "REJECTED"

    def is_valid(self):
        return self.status == "VALID" and self.distance_to_site <= 2.0

    def get_distance(self):
        return self.distance_to_site

    def get_type(self):
        return self.clock_in_type

    def get_session_duration(self, arrival_record):
        if self.clock_in_type != "DEPARTURE":
            raise Exception("get_session_duration() is only available on a DEPARTURE record")
        if arrival_record.clock_in_type != "ARRIVAL":
            raise Exception("The provided record is not an ARRIVAL")

        fmt           = "%H:%M:%S"
        arrival_time  = datetime.strptime(arrival_record.clock_in_time, fmt)
        departure_time = datetime.strptime(self.clock_in_time, fmt)
        return departure_time - arrival_time

    def __repr__(self):
        return (f"ClockInRecord({self.user.first_name} {self.user.last_name} | "
                f"{self.clock_in_type} | {self.clock_in_time} | "
                f"{self.status} | {self.distance_to_site:.2f} km)")


# ── PROJECT ───────────────────────────────────────────────
class Project:

    def __init__(self, id, name, address, description, city, start_date, end_date,
                 total_budget, project_manager, created_by, status="IN_PROGRESS"):

        if not created_by.can("MANAGE_PROJECTS"):
            raise Exception(f"{created_by.first_name} is not authorized to create a project")
        if status not in PROJECT_STATUSES:
            raise Exception(f"Invalid status: {status}")

        self.id              = id
        self.name            = name
        self.address         = address
        self.description     = description
        self.city            = city
        self.start_date      = start_date
        self.end_date        = end_date
        self.total_budget    = total_budget
        self.project_manager = project_manager
        self.created_by      = created_by
        self.status          = status
        self.sites           = []

    def update_project(self, updated_by, **kwargs):
        if not updated_by.can("MANAGE_PROJECTS"):
            raise Exception("Permission denied")
        for key, value in kwargs.items():
            if key in ['name', 'city', 'total_budget', 'status']:
                if key == 'status' and value not in PROJECT_STATUSES:
                    continue
                setattr(self, key, value)

    def delete_project(self, deleted_by):
        if not deleted_by.can("MANAGE_PROJECTS"):
            raise Exception("Permission denied")
        if any(s.is_active() for s in self.sites):
            raise Exception("Cannot delete: project has active sites")
        self.status = "ARCHIVED"

    def add_site(self, site):
        if self.status in ["COMPLETED", "ARCHIVED"]:
            raise Exception("Cannot add a site: project is closed")
        if site in self.sites:
            raise Exception("This site is already linked to the project")
        self.sites.append(site)

    def get_sites(self):
        return self.sites

    def get_active_sites(self):
        return [s for s in self.sites if s.is_active()]

    def is_active(self):
        return self.status == "IN_PROGRESS"

    def get_spent_budget(self):
        return sum(s.allocated_budget for s in self.sites)

    def get_remaining_budget(self):
        return self.total_budget - self.get_spent_budget()

    def __repr__(self):
        return (f"Project({self.name} | {self.city} | {self.status} | "
                f"Budget: {self.total_budget} | Sites: {len(self.sites)})")


# ── SITE (CHANTIER) ───────────────────────────────────────
class Site:

    def __init__(self, id, project, name, location, address, description,
                 start_date, end_date, area, allocated_budget,
                 site_manager, created_by, status="ACTIVE"):

        if not created_by.can("MANAGE_SITE"):
            raise Exception("Action not authorized")
        if status not in SITE_STATUSES:
            raise Exception(f"Invalid status: {status}")

        self.id               = id
        self.project          = project
        self.name             = name
        self.location         = location  # (lat, lng)
        self.address          = address
        self.description      = description
        self.start_date       = start_date
        self.end_date         = end_date
        self.area             = area
        self.allocated_budget = allocated_budget
        self.site_manager     = site_manager
        self.created_by       = created_by
        self.status           = status

        self.clock_in_records = []
        self.photos           = []
        self.teams            = []

    def update_site(self, updated_by, **kwargs):
        if not updated_by.can("MANAGE_SITE"):
            raise Exception("Permission denied")
        if 'allocated_budget' in kwargs:
            diff = kwargs['allocated_budget'] - self.allocated_budget
            if diff > self.project.get_remaining_budget():
                raise Exception("Project budget exceeded")
        for key, value in kwargs.items():
            if key in ['name', 'allocated_budget', 'status']:
                setattr(self, key, value)

    # ── GPS Verification ──────────────────────────────────
    def verify_clock_in(self, user, lat, lng):
        lat1, lng1 = self.location
        lat2, lng2 = lat, lng
        R     = 6371
        d_lat = math.radians(lat2 - lat1)
        d_lng = math.radians(lng2 - lng1)
        a     = (math.sin(d_lat / 2) ** 2 +
                 math.cos(math.radians(lat1)) *
                 math.cos(math.radians(lat2)) *
                 math.sin(d_lng / 2) ** 2)
        return round(R * 2 * math.asin(math.sqrt(a)), 2)

    def has_open_session(self, user):
        arrivals   = [r for r in self.clock_in_records
                      if r.user.id == user.id and r.clock_in_type == "ARRIVAL" and r.is_valid()]
        departures = [r for r in self.clock_in_records
                      if r.user.id == user.id and r.clock_in_type == "DEPARTURE" and r.is_valid()]
        return len(arrivals) > len(departures)

    # ── Teams ─────────────────────────────────────────────
    def assign_team(self, team):
        if team in self.teams:
            raise Exception("This team is already assigned to the site")
        self.teams.append(team)

    def get_teams(self):
        return self.teams

    # ── Clock-in records ──────────────────────────────────
    def add_clock_in_record(self, record):
        self.clock_in_records.append(record)

    def get_clock_in_records(self):
        return self.clock_in_records

    def count_present_today(self, date):
        present = set()
        for r in self.clock_in_records:
            if r.clock_in_date == date and r.clock_in_type == "ARRIVAL" and r.is_valid():
                present.add(r.user.id)
        return len(present)

    def get_present_workers(self, date):
        if not self.is_active():
            raise Exception("This site is not active")
        present = {}
        for r in self.clock_in_records:
            if r.clock_in_date == date and r.is_valid():
                if r.clock_in_type == "ARRIVAL":
                    present[r.user.id] = r.user
                elif r.clock_in_type == "DEPARTURE":
                    present.pop(r.user.id, None)
        return list(present.values())

    def get_deletion_logs(self, requester):
        if not requester.can("VIEW_DELETION_LOGS"):
            raise Exception("Permission denied")
        logs = []
        for photo in self.photos:
            if photo.is_deleted and hasattr(photo, 'log'):
                logs.append(photo.log)
        return logs

    # ── Photos ────────────────────────────────────────────
    def add_photo(self, photo):
        self.photos.append(photo)

    def get_photos(self):
        return self.photos

    # ── Status ────────────────────────────────────────────
    def is_active(self):
        return self.status == "ACTIVE"

    def __repr__(self):
        return (f"Site({self.name} | {self.status} | "
                f"Budget: {self.allocated_budget} | "
                f"Records: {len(self.clock_in_records)} | "
                f"Photos: {len(self.photos)})")


# ── TEAM ──────────────────────────────────────────────────
class Team:

    def __init__(self, id, name, site, created_by,
                 description=None, team_lead=None, status="ACTIVE"):

        if not created_by.can("MANAGE_TEAM"):
            raise Exception(f"{created_by.first_name} is not authorized to create a team")
        if status not in TEAM_STATUSES:
            raise Exception(f"Invalid status: {status}")

        self.id          = id
        self.name        = name
        self.site        = site
        self.created_by  = created_by
        self.description = description
        self.team_lead   = team_lead
        self.status      = status
        self.members     = []

    def add_member(self, user, team_role):
        if team_role not in TEAM_ROLES:
            raise Exception(f"Invalid team role: {team_role}")
        if self.has_member(user):
            raise Exception(f"{user.first_name} is already a member of this team")
        member = TeamMember(team=self, user=user, team_role=team_role)
        self.members.append(member)
        return member

    def remove_member(self, user):
        for m in self.members:
            if m.user.id == user.id and m.is_active():
                m.end_assignment(datetime.now().strftime("%Y-%m-%d"))
                return
        raise Exception(f"{user.first_name} is not an active member of this team")

    def get_members(self):
        return [m for m in self.members if m.is_active()]

    def has_member(self, user):
        return any(m.user.id == user.id and m.is_active() for m in self.members)

    def is_active(self):
        return self.status == "ACTIVE"

    def __repr__(self):
        return (f"Team({self.name} | {self.status} | "
                f"Active members: {len(self.get_members())})")


# ── TEAM MEMBER ───────────────────────────────────────────
class TeamMember:

    def __init__(self, team, user, team_role):
        self.team             = team
        self.user             = user
        self.team_role        = team_role
        self.assignment_date  = datetime.now().strftime("%Y-%m-%d")
        self.end_date         = None
        self.status           = "ACTIVE"

    def is_active(self):
        return self.status == "ACTIVE"

    def end_assignment(self, date):
        self.status   = "INACTIVE"
        self.end_date = date

    def __repr__(self):
        return (f"TeamMember({self.user.first_name} {self.user.last_name} | "
                f"{self.team_role} | {self.status})")


# ── PHOTO ─────────────────────────────────────────────────
class Photo:

    def __init__(self, site, user, filename, category=None):
        if category and category not in PHOTO_CATEGORIES:
            raise Exception(f"Invalid category: {category}")

        self.site       = site
        self.user       = user
        self.filename   = filename
        self.category   = category
        self.taken_at   = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.is_deleted = False

    def delete(self, deleted_by, reason):
        if not deleted_by.can("DELETE_PHOTO"):
            raise Exception("Permission denied: insufficient role")
        if not deleted_by.is_active:
            raise Exception("User account is inactive")
        if not reason or reason.strip() == "":
            raise Exception("A reason is required for deletion")
        if self.is_deleted:
            raise Exception("This photo has already been deleted")

        self.is_deleted = True
        log = DeletionLog(photo=self, deleted_by=deleted_by, reason=reason)
        return log

    def get_url(self):
        return self.filename

    def __repr__(self):
        status = "DELETED" if self.is_deleted else "ACTIVE"
        return (f"Photo({self.user.first_name} | "
                f"{self.category} | {self.taken_at} | {status})")


# ── DELETION LOG ──────────────────────────────────────────
class DeletionLog:

    def __init__(self, photo, deleted_by, reason):
        self.photo        = photo
        self.deleted_by   = deleted_by
        self.reason       = reason
        self.deleted_at   = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def get_details(self):
        return (f"[LOG] Photo deleted by {self.deleted_by.first_name} "
                f"{self.deleted_by.last_name} on {self.deleted_at} "
                f"| Reason: {self.reason}")

    def __repr__(self):
        return self.get_details()


# ══════════════════════════════════════════════════════════
# TESTS — End-to-end scenario
# ══════════════════════════════════════════════════════════
if __name__ == "__main__":

    print("=" * 55)
    print("        END-TO-END SCENARIO — CHANTIERPRO")
    print("=" * 55)

    # ── Users ─────────────────────────────────────────────
    manager    = User(1, "Diallo",  "Moussa", "hash1", "PROJECT_MANAGER", "0700000001")
    technician = User(2, "Kouame",  "Jean",   "hash2", "TECHNICIAN",      "0700000002")
    director   = User(3, "Konan",   "Aya",    "hash3", "DIRECTION",       "0700000003")
    hr         = User(4, "Bamba",   "Fatou",  "hash4", "HR",              "0700000004")

    # ── Project ───────────────────────────────────────────
    print("\n── Project Creation ──")
    project = Project(
        id=1, name="Plateau Renovation", address="Rue de Lyon",
        description="Full building renovation", city="Abidjan",
        start_date="2026-01-01", end_date="2026-12-31",
        total_budget=50_000_000, project_manager=manager, created_by=manager
    )
    print(project)

    # ── Site ──────────────────────────────────────────────
    print("\n── Site Creation ──")
    site = Site(
        id=1, project=project, name="Building A",
        location=(5.3600, -4.0083),
        address="Rue de Lyon, Abidjan",
        description="Main building renovation",
        start_date="2026-02-01", end_date="2026-10-31",
        area=500, allocated_budget=20_000_000,
        site_manager=manager, created_by=manager
    )
    project.add_site(site)
    print(site)
    print("Spent budget  :", project.get_spent_budget())    # 20 000 000
    print("Remaining budget:", project.get_remaining_budget())  # 30 000 000

    # ── Team ──────────────────────────────────────────────
    print("\n── Team Creation ──")
    team = Team(id=1, name="Team A", site=site, created_by=manager)
    team.add_member(technician, "MEMBER")
    site.assign_team(team)
    print(team)
    print("Has technician?", team.has_member(technician))  # True

    # ── Valid clock-in ────────────────────────────────────
    print("\n── Arrival Clock-in (valid) ──")
    arrival = technician.clock_in(site, "ARRIVAL", 5.3612, -4.0091)
    site.add_clock_in_record(arrival)
    print(arrival)
    print("Is valid?", arrival.is_valid())                              # True
    print("Present today:", site.count_present_today(arrival.clock_in_date))  # 1

    # ── Rejected clock-in (too far) ───────────────────────
    print("\n── Clock-in Rejected (too far) ──")
    try:
        technician.clock_in(site, "ARRIVAL", 5.4200, -4.1000)
    except Exception as e:
        print("Expected error:", e)

    # ── Photo ─────────────────────────────────────────────
    print("\n── Taking a Photo ──")
    photo = technician.take_photo(site, "progress_photo.jpg", "PROGRESS")
    site.add_photo(photo)
    print(photo)

    # ── Photo deletion by manager ─────────────────────────
    print("\n── Photo Deletion by Manager ──")
    log = photo.delete(manager, "Blurry photo, does not meet quality standards")
    print(log)

    # ── Deletion rejected (technician) ───────────────────
    print("\n── Deletion Rejected (technician) ──")
    photo2 = technician.take_photo(site, "incident_photo.jpg", "INCIDENT")
    try:
        photo2.delete(technician, "Test")
    except Exception as e:
        print("Expected error:", e)

    # ── Clock-in history ──────────────────────────────────
    print("\n── Clock-in History ──")
    history = technician.get_clock_in_history(site)
    for r in history:
        print(r)

    # ── Present workers (manager view) ────────────────────
    print("\n── Present Workers ──")
    present = site.get_present_workers(arrival.clock_in_date)
    for u in present:
        print(u)

    # ── Departure clock-in ────────────────────────────────
    print("\n── Departure Clock-in ──")
    departure = technician.clock_in(site, "DEPARTURE", 5.3612, -4.0091)
    site.add_clock_in_record(departure)
    print(departure)
    print("Session duration:", departure.get_session_duration(arrival))

    # ── Double arrival rejected ───────────────────────────
    print("\n── Double Arrival Rejected ──")
    arrival2 = technician.clock_in(site, "ARRIVAL", 5.3612, -4.0091)
    site.add_clock_in_record(arrival2)
    try:
        technician.clock_in(site, "ARRIVAL", 5.3612, -4.0091)
    except Exception as e:
        print("Expected error:", e)

    # ── HR data export ────────────────────────────────────
    print("\n── HR Data Export ──")
    export = hr.export_data(site, month=4, year=2026)
    for row in export:
        print(row)

    print("\n" + "=" * 55)
    print("        SCENARIO COMPLETED — NO ERRORS ✅")
    print("=" * 55)