Fitness Intelligence Dashboard
MVP Product & Technical Specification
Version 1.0
1. Product Vision

Build a mobile-first fitness, nutrition and self-analysis application that helps users understand:

What they consumed
What they trained
What activities they performed
How consistently they followed their personal targets
How their body metrics changed
What their current recommendation cycle looks like
What they should focus on next

The application is a tracking and analysis tool, not an enforcement-based coach.

AI recommendations are guidance.

The system must measure actual behaviour independently from whether the user followed the AI's exact recommended workout or schedule.

Core philosophy

Useful information over maximum information.

The application should be:

visually distinctive
calm
data-driven
easy to understand
mobile-first
fast
inexpensive to operate
transparent about estimates
deterministic wherever possible
AI-assisted only where AI adds meaningful value

Avoid:

infinite scrolling
unnecessary cards
excessive animations
excessive colours
gamification everywhere
leaderboards
motivational noise
AI-generated prose for ordinary calculations
treating recommendations as requirements
2. Visual Direction
Design identity

Modern Fitness Intelligence Dashboard

Visual inspiration:

Data/trading dashboard layouts
Premium health/fitness dashboards
Subtle brutalist/terminal/Glitch influence

Do NOT copy reference designs directly.

The product should combine their useful visual characteristics into an original design.

Visual principles
dark-first interface
black/charcoal foundation
warm off-white primary text
muted grey secondary information
restrained muted green accent
strong typography
large numerical metrics
rectangular information blocks
subtle corner radius
clear dividers
progress bars
meaningful charts
consistent outline icons
limited animation
intentional whitespace
no visual clutter
Palette
Background       #0A0B0A
Surface 1        #111311
Surface 2        #171917
Border           #2A2D2A

Primary text     #F1EFE7
Secondary text   #A5A49D
Muted text       #6F716C

Accent           #7C9686
Accent surface   #18221C

Warning          #B59A68
Error            #B87570

Do not use neon green.

Do not introduce arbitrary colours into individual components.

All colours must come from design tokens.

Typography

Use a modern highly legible sans-serif for general UI.

Use a strong condensed/bold display style for:

calories
weight
steps
percentages
major statistics

Use monospace selectively for technical labels such as:

SEP 21
CYCLE 03
TARGET
SYNCED

Do not turn the entire interface into a terminal.

Icons

Use one consistent outline icon family.

Recommended icon mapping:

Food             utensils / plate
Calories         flame
Protein          strength / muscle
Carbs            grain / energy
Fat              droplet
Fiber            leaf
Steps            footprint
Workout          dumbbell
Activity         running
Weight           scale
Progress         chart
Goals            target
Groups           users
Profile          person
Settings         gear

Do not use emoji as primary UI icons.

Cards

Do not make every component a generic rounded SaaS card.

Prefer:

rectangular blocks
subtle 4–8px radius
thin borders
dividers
grouped sections
strong typography

Use rounded controls only where they improve usability.

3. Technology Stack
Frontend
React
TypeScript
Vite
Tailwind CSS
shadcn/ui where useful
React Router
TanStack Query
Zod
Recharts

Vite officially supports a React TypeScript template.

Tailwind should use its current Vite integration rather than an outdated configuration approach.

Backend

Supabase:

PostgreSQL
Supabase Auth
Supabase Storage
Edge Functions
Row Level Security
database functions/triggers where appropriate

Supabase's current React documentation supports the Vite + React + supabase-js architecture and recommends RLS for database access.

Hosting

Initial:

Vercel or equivalent static/frontend hosting
Supabase backend

Use PWA support so the web application can be installed on mobile.

Future:

Expo / React Native mobile application can reuse the same Supabase backend and domain models.

Do NOT build a native mobile application in Phase 1.

4. High-Level Architecture
                    ┌──────────────────┐
                    │   React + Vite   │
                    │   Mobile-first   │
                    └────────┬─────────┘
                             │
                    Supabase client
                             │
             ┌───────────────┼────────────────┐
             │               │                │
             ▼               ▼                ▼
        PostgreSQL         Auth             Storage
             │
             │
             ▼
      Row Level Security
             │
             ▼
      Supabase Functions
             │
             ▼
       AI Provider Layer
             │
             ▼
       AI Model Provider

AI credentials must NEVER be exposed in the browser.

All AI processing must happen server-side.

5. Authentication
Phase 1

Login:

Phone Number
4-digit PIN

No OTP.

Phone number must be unique.

Admin creates the initial user account.

Admin assigns:

phone number
initial PIN

User logs in and completes onboarding.

Session

Normal authenticated session.

Do not build complicated device/session management in MVP.

PIN management

Admin can:

create PIN
reset PIN

User can optionally change PIN later.

6. Roles
Super Admin

Everything.

Can:

manage admins
manage managers/trainers
manage users
manage groups
manage food database
manage recommendations
manage AI settings
modify locked records
inspect audit logs
manage system configuration
Admin

Operational access across users.

Can:

create users
reset PINs
edit users
modify locked records
manage food database
review submitted foods
manage groups where applicable
run monthly processing
inspect AI processing
inspect audit records

Cannot manage super-admin authority.

Manager / Trainer

Can see only assigned users.

Can:

monitor assigned users
view permitted progress
view workouts/nutrition/activity relevant to assigned users

Cannot see unrelated users.

Relationship:

manager
   │
   ├── user A
   ├── user B
   ├── user C
   └── user D
User

Can:

manage own profile
log own food
log workouts
log activities
log steps
log weight
upload InBody
review recommendations
modify recommendation targets during review
create/join groups
see permitted group information
Group Leader

A user with limited additional group permissions.

Keep this intentionally simple.

Do not build an organization hierarchy.

7. Soft Deletion

User accounts must not be hard-deleted during normal operations.

Use:

is_active
deleted_at
deactivated_by

Historical records remain intact.

Normal user-facing queries exclude deactivated users.

8. Main Navigation

Mobile:

Home
Food
Workout
Progress
Groups

Profile is accessed from the top-right/profile control.

Desktop:

Persistent sidebar:

HOME
FOOD
WORKOUT
PROGRESS
GROUPS

────────────

PROFILE

Admin has a separate admin navigation.

9. Home Screen

Home is today-focused.

It should answer:

How am I doing today?
What have I completed?
What remains?
What should I do next?
Top section
MON 21 SEP

GOOD MORNING
ROHITH

If profile is incomplete:

PROFILE INCOMPLETE

Complete your profile to receive
personalized recommendations.

Use a light-red/muted warning background with black text.

Nutrition

Primary calorie block:

1,450
/ 2,000 KCAL

████████████████░░░░

Then compact nutrient rows:

PROTEIN    105 / 140 G
████████████████░░░░

CARBS      180 / 250 G
██████████████░░░░░░

FAT         48 / 65 G
███████████████░░░░░

FIBER       18 / 30 G
████████████░░░░░░░░
Today
7,842
STEPS

and:

WORKOUT
✓ COMPLETED
Today's recommendation

One-line recommendation only.

Example:

NEXT SESSION
LOWER BODY · 45–60 MIN

Detailed information belongs inside Add Workout.

Primary actions

Exactly:

+ ADD FOOD
+ ADD WORKOUT
+ ADD ACTIVITY

Do not add unnecessary primary actions.

Current goals

Small section:

CURRENT FOCUS

FAT LOSS
MUSCLE BUILDING

Only current locked cycle goals.

10. Food

Food flow:

Add Food
   ↓
Add Meal
   ↓
Select Food
   ↓
Select Quantity
   ↓
Review
   ↓
Save

Meal category is optional.

Possible filters:

BREAKFAST
LUNCH
DINNER
SNACKS

But users do not have to assign a category.

Food selector

Ranking:

recently used
frequently used
matching shared foods
search results

Display approximately 10 quick suggestions when appropriate.

Each result:

Chicken Breast

165 kcal
31g protein
0g carbs
3.6g fat
0g fiber

Nutrition values must be labelled approximately where appropriate.

Meal copying

Allow:

Copy previous meal

Copied meal becomes a new independent record.

Editing the copied meal never changes the original.

11. Food Database

Shared curated database.

Initial focus:

Indian foods
Hyderabad/common local foods
household foods
protein sources
common restaurant/outside foods

Admin can create/edit foods.

User-created foods

User provides:

name
calories
protein
carbohydrates
fat
fiber

Status:

PENDING_REVIEW
APPROVED
REJECTED

Admin can edit and approve.

Approved food becomes shared.

Potential duplicate detection:

Normalize food names and flag likely duplicates.

Admin can merge duplicate foods.

Historical meal snapshots must not change after a food merge.

12. Historical Nutrition Snapshot

Every food item logged into a meal stores the nutrition values applicable at that moment.

Concept:

food_master
    ↓
meal_item_snapshot

If the master food changes later:

Historical meals do NOT change.

While a meal is editable:

quantity changed
       ↓
snapshot recalculated

After lock:

snapshot permanently fixed
13. Food Locking

User can edit/delete until the next day.

After that:

LOCKED

User cannot modify or delete.

Admin can modify/delete.

Admin changes create audit entries.

If an admin changes a locked record:

original value
new value
admin ID
timestamp
reason optional
14. Workout

Phase 1 workout record:

Workout type
Duration
Estimated calories
Optional manual calorie override

No exercise-level sets/reps/weight tracking.

Workout types

Examples:

CHEST
BACK
SHOULDERS
BICEPS
TRICEPS
LEGS

CHEST + TRICEPS
BACK + BICEPS
SHOULDERS + ARMS

UPPER BODY
LOWER BODY
FULL BODY

HIIT
CARDIO
ATHLETIC / PERFORMANCE
CUSTOM

Any valid logged workout counts toward workout frequency.

It does not need to match the AI recommendation.

15. Workout Calories

Estimated calories use a configurable estimation system.

Phase 1 may use:

duration × estimated intensity/calorie rate

where the default assumption is based on the application's simplified strength-training model.

UI must show:

Estimated based on the default workout assumption. Actual expenditure may vary.

Manual calorie override is allowed.

16. Workout Capacity

User specifies:

2–6 days/week

This means:

"I can realistically work out this many times per week."

It does NOT mean:

exact weekdays
fixed rest days
exact AI workout schedule

AI generates exactly that many sessions per week.

Example:

Capacity = 4

Recommended template:
1. Upper Body
2. Lower Body
3. Pull
4. Full Body

The user can perform these on any days.

17. Workout Adherence

Weeks are strictly:

Monday → Sunday

Never rolling 7-day windows.

Example:

Target = 4

Mon ✓
Tue ✓
Wed -
Thu ✓
Fri -
Sat ✓
Sun -

Completion = 4 / 4

Existing workouts before recommendation generation still count.

If recommendation starts mid-week, existing workouts count for that calendar week.

Transition weeks must not unfairly penalize users when capacity changes.

18. Activity Tracking

Activities are separate from workouts.

Examples:

Walking
Running
Cycling
Treadmill
Cricket
Badminton
Swimming
Football
Basketball
Hiking / Trekking
Custom

Record:

activity
duration
estimated calories
optional manual calories

Activity frequency has no target in Phase 1.

Do not display:

Activity goal failed
Activity goal met
Activity on track

Instead show:

8 ACTIVITIES
3h 40m
2,100 KCAL ESTIMATED
19. Steps

Users can enter steps multiple times per day.

The latest valid entry becomes the active value.

Keep entry history for audit purposes.

No phone-health integration in Phase 1.

No step goal is required unless a future feature explicitly introduces one.

20. Weight

Manual weight can be entered whenever needed.

Every measurement includes:

date
weight_kg
source

Source:

MANUAL
INBODY

InBody weight appears in the overall weight history.

Do not create a separate disconnected weight system.

21. InBody

Users/admins can upload:

photo
report

Extract/store structured values where available:

weight
body fat %
muscle mass
BMI
BMR
other supported metrics

Keep:

original report
structured extracted data
date
source

InBody is optional.

It may be:

monthly
every 2 months
every 3 months
irregularly

Latest valid report available by recommendation processing cutoff is used.

If no newer InBody exists, carry forward the latest valid metrics.

For recommendation processing:

InBody available by cutoff?
    YES → use latest applicable InBody
    NO  → use latest valid available metrics

If both manual and InBody weight exist:

InBody takes precedence for recommendation input

Manual measurements remain visible in history.

22. Goals
Long-term goal

Example:

Fat Loss
Muscle Gain
General Fitness
Performance
Short-term goals

Multiple allowed.

Examples:

Muscle Building
Recomposition
Cricket Performance
Badminton Performance
Flexibility
Endurance
General Fitness
Free-text objective

User may describe their objective.

Cycle locking

Goals used for the current recommendation cycle are locked for that cycle.

Changing profile goals affects the next cycle.

Admin may explicitly reprocess a cycle if necessary.

23. Activity Level

Options:

Sedentary
Lightly Active
Moderately Active
Very Active
Extremely Active

Optional.

24. Nutrition Targets

Primary:

Calories
Protein
Carbohydrates
Fat
Fiber

No primary micronutrient tracking in Phase 1.

AI may consider micronutrient adequacy qualitatively based on available information.

25. Daily Target Logic

A recommendation cycle creates:

calorie target
protein target
carb target
fat target
fiber target

These remain fixed for the active cycle.

Weight changes during the cycle do NOT automatically change the target.

Next cycle can adjust targets.

26. Target Snapshots

This is a critical architecture requirement.

Every day must be associated with the target applicable on that date.

Example:

Sep 01 → cycle A targets
Sep 02 → cycle A targets
Sep 03 → cycle A targets
Sep 04 → cycle B targets
...
Oct 04 → cycle B targets
Oct 05 → cycle C targets

Store daily target snapshots.

Do not calculate historical adherence using today's target.

27. Nutrition Tolerance

Global Phase 1 setting:

85%

Admin can configure:

80%
85%
90%

For higher-is-better nutrients:

meeting target =
actual >= target × tolerance

Example:

Protein target = 140g
Tolerance = 85%

Minimum qualifying amount:
140 × .85 = 119g

Therefore:

119g → meets
118g → does not meet
Calories

Calories are different.

Going substantially above target is not considered better.

Use a configurable acceptable range around target.

Recommended Phase 1 default:

Lower bound = target × 0.85
Upper bound = target × 1.10

Example:

Target = 2,000

Acceptable:
1,700 → 2,200

This is a configurable system rule.

Do not use "more calories = better".

28. Nutrition Adherence

Use eligible tracked days.

Example:

Protein:

16 days met
22 eligible tracked days

Adherence:
72.7%

Do not interpret:

no food record

as:

0 calories

Missing data remains missing.

29. Recommendation Cycle

Calendar month is mainly a UI concept.

The real analytical period is:

Recommendation generated
        ↓
Next recommendation generated

Example:

Sep 04 → Oct 05

That is the actual analytical cycle.

The UI may call it:

September Progress

but must transparently display:

Recommendation cycle:
Sep 04 – Oct 04
30. Monthly Processing

Target processing date:

4th of each month

This is the ideal date, not a hard dependency.

If processing is delayed:

previous active plan remains active

Do not automatically change targets on the first day of the month.

31. User Feedback Window

Users can enter monthly feedback from:

1st → processing date

Example:

Oct 1
Oct 2
Oct 3
Oct 4

Once processing occurs, feedback becomes locked.

Feedback is included in AI input.

Example:

"The current split is difficult to follow. I'd prefer something more varied."

32. Recommendation Review

When a recommendation is generated:

Generated: Oct 4
Review: Oct 4–5
Auto-lock: Oct 6

If generated Oct 5:

Review: Oct 5–6
Auto-lock: Oct 7

The review window is always 2 calendar days from actual generation.

User can:

ACCEPT & LOCK

or simply leave it.

System auto-locks after the review period.

33. Recommendation Editing

User can edit:

calories
protein
carbohydrates
fat
fiber
workout schedule/template

User cannot edit:

workout capacity
long-term goal
short-term focus

Display:

Recommended target — change only if advised by your nutritionist or coach.

Preserve:

AI recommended value
final active value

Never overwrite the original AI recommendation.

Record:

old value
new value
who changed it
when
34. AI Engine

AI is NOT a chatbot.

It is a monthly recommendation engine.

Flow:

Monthly Processing
       ↓
Build standardized summary
       ↓
Budget check
       ↓
Batch users
       ↓
AI provider
       ↓
Validate response
       ↓
Store recommendation
       ↓
Create target snapshots
       ↓
Mark success/failure
35. AI Input

Never send all raw records.

Create compact standardized JSON.

Example:

{
  "processing_month": "2026-10",
  "user": {
    "age": 30,
    "gender": "male",
    "weight_kg": 75,
    "height_cm": 175,
    "activity_level": "moderate"
  },
  "goals": {
    "long_term": "fat_loss",
    "short_term": [
      "muscle_building",
      "general_fitness"
    ],
    "description": "..."
  },
  "workout": {
    "days_per_week": 4,
    "previous_completion": "14/16",
    "previous_plan": "..."
  },
  "previous_month": {
    "avg_calories": 1850,
    "target_calories": 2000,
    "avg_protein_g": 125,
    "target_protein_g": 140,
    "avg_carbs_g": 210,
    "avg_fat_g": 58,
    "avg_fiber_g": 24,
    "weight_change_kg": -0.8,
    "body_fat_change_percent": -0.5,
    "workouts_completed": 14,
    "workouts_expected": 16,
    "activities_completed": 8,
    "activity_calories": 2100
  },
  "inbody": {
    "latest_date": "2026-09-02",
    "weight_kg": 75,
    "body_fat_percent": 22.4,
    "muscle_mass_kg": 32.1
  },
  "user_feedback": "..."
}

Actual schema should be strongly typed and versioned.

36. AI Output

Require structured JSON.

Concept:

{
  "assessment": "...",
  "targets": {
    "calories": 2050,
    "protein_g": 145,
    "carbs_g": 230,
    "fat_g": 65,
    "fiber_g": 30
  },
  "long_term_goal": "...",
  "short_term_focus": [],
  "workout_plan": {
    "days_per_week": 4,
    "sessions": []
  },
  "activity_recommendation": "...",
  "nutrition_suggestions": [],
  "improve": [],
  "watch": [],
  "summary": "..."
}

The output should be concise.

Do not ask the AI to generate long motivational text.

37. AI Provider Abstraction

Never hard-code business logic around one provider.

Create:

AIProvider

interface.

Example conceptual methods:

generateRecommendation(input)
estimateCost(input)
validateResponse(response)

Provider implementation can later be changed.

Store:

provider
model
prompt_version

for every run.

38. AI Processing Batches

Initial configurable batch:

10–15 users

But architecture must allow dynamic adjustment.

Batch size can later be changed based on:

token usage
provider limits
cost
latency
quality

One failure must NOT stop the entire batch.

Each user has an independent result.

39. AI Budget

AI budget is a first-class system setting.

Example:

Monthly AI budget:
₹X

Before processing each batch:

current estimated/actual spend
+
estimated batch cost
≤ budget?

If not:

STOP PROCESSING

Remaining users remain:

PENDING

They can resume when:

next budget period starts
admin increases budget
admin explicitly resumes processing

---

# 40. AI Cost Tracking

For every request store:

```text
input_tokens
output_tokens
total_tokens
estimated_cost
actual_cost if available
provider
model
batch_id
processing_run_id
timestamp

Dashboard:

REQUESTS
TOKENS
COST
SUCCESS
FAILED
PENDING
41. AI Processing States

Per user:

PENDING
PROCESSING
SUCCESS
FAILED
SKIPPED

Processing run:

CREATED
RUNNING
PARTIAL
COMPLETED
STOPPED_BUDGET
FAILED
42. Admin Monthly Processing Screen

Example:

OCTOBER 2026 PROCESSING

READY             84
INCOMPLETE         7
SKIPPED            3
FAILED             2
SUCCESS           68
PENDING            6

[ PROCESS ALL READY ]

[ SELECT USERS ]

AI USAGE
Requests: 7
Tokens: 84,230
Cost: ₹XXX

Per-user table:

User
Status
Reason
Model
Tokens
Cost
Generated
Actions

Actions:

View
Retry
Reprocess

Successful users should not be unnecessarily reprocessed.

43. Recommendation Storage

Each processing record stores:

id
user_id
cycle_id
processing_run_id

raw_input_json
raw_output_json

parsed_recommendation_json

recommended_calories
recommended_protein
recommended_carbs
recommended_fat
recommended_fiber

final_calories
final_protein
final_carbs
final_fat
final_fiber

provider
model
prompt_version

input_tokens
output_tokens
total_tokens
estimated_cost

status
failure_reason

generated_at
review_deadline
locked_at
44. Progress Screen

Primary selector:

7D
30D
3M
6M
1Y
Body
weight trend
body fat
muscle mass
InBody changes
Nutrition
calories vs target
protein vs target
carbs vs target
fat vs target
fiber vs target
average intake
Training
workouts
weekly completion
activities
estimated expenditure
Steps
step trend
average steps

Do not treat missing records as zero.

45. Charts

Only use charts where they provide insight.

Recommended:

line chart for weight
line chart for body fat
bar/line comparison for calories vs target
nutrient progress
weekly workout completion
steps trend
activity expenditure

Avoid:

decorative pie charts
3D charts
excessive legends
rainbow charts
46. Groups

Users can create a group:

name
description
code

One code.

No code regeneration in Phase 1.

Multiple group memberships allowed.

Any member may leave.

Only group admin can remove other members.

Joining
Join Group
   ↓
Enter Code
   ↓
Confirm Group
   ↓
Join

Immediate access.

47. Group Cards

Default:

TODAY

Date picker allows historical viewing where permitted.

Each member is represented by one card.

Visible:

Calories
Protein
Steps
Workout status

Examples:

1,450 / 2,000 KCAL
105 / 140 G PROTEIN
7,842 STEPS
✓ WORKOUT

Private:

Weight
Body fat
InBody
Detailed calculation inputs

No ranking.

No leaderboard.

No score.

48. Group Data Rule

Group data represents current active data.

If user edits a record while editable:

group immediately reflects updated active value

If a member leaves/is removed:

their previous group-visible information
must no longer be accessible

Do not expose historical group data to people who no longer belong.

Group Leader may have limited historical access as defined by role permissions.

49. Database

Core tables:

profiles
user_roles
manager_user_assignments

goals
goal_focuses

recommendation_cycles
recommendation_processing_runs
recommendation_processing_users
daily_target_snapshots

food_items
food_item_versions
food_submissions
food_merges

meals
meal_items

workouts
activities
steps_entries
weight_measurements

inbody_reports
inbody_metrics

groups
group_memberships

audit_logs

system_settings
ai_usage_records
50. Key Profile Table

Conceptual fields:

profiles
---------
id
auth_user_id
phone
name
date_of_birth / age-derived fields as appropriate
gender
height_cm
current_weight_kg
activity_level
job
hobbies
objective
bmr
is_profile_complete
is_active
created_at
updated_at

Do not store redundant age permanently if date of birth is used.

If MVP explicitly uses age rather than DOB, store age input with a documented strategy.

51. Roles
user_roles
----------
id
user_id
role
created_at
created_by

Enum:

SUPER_ADMIN
ADMIN
MANAGER
USER

Group leader should be a group membership role, not a global system role.

52. Manager Assignments
manager_user_assignments
------------------------
id
manager_id
user_id
created_at
created_by

RLS must ensure manager access only to assigned users.

53. Goals
goals
-----
id
user_id
long_term_goal
description
effective_from
effective_to
is_active
created_at
updated_at

Separate short-term focus records if multiple are required:

goal_focuses
------------
id
goal_id
focus_type
priority
54. Recommendation Cycle
recommendation_cycles
---------------------
id
user_id

period_start
period_end

generated_at
review_deadline
locked_at

status

raw_input_json
raw_output_json
parsed_output_json

provider
model
prompt_version

recommended_calories
recommended_protein
recommended_carbs
recommended_fat
recommended_fiber

final_calories
final_protein
final_carbs
final_fat
final_fiber

workout_plan_json
activity_recommendation_json

created_at
updated_at
55. Daily Target Snapshot
daily_target_snapshots
----------------------
id
user_id
recommendation_cycle_id
target_date

calories
protein_g
carbs_g
fat_g
fiber_g

created_at

Unique:

(user_id, target_date)
56. Meals
meals
-----
id
user_id
meal_date
meal_name
meal_category
is_locked
is_deleted

created_at
updated_at
locked_at
57. Meal Items
meal_items
----------
id
meal_id
food_item_id

quantity
unit

snapshot_calories
snapshot_protein_g
snapshot_carbs_g
snapshot_fat_g
snapshot_fiber_g

is_deleted
created_at
updated_at
58. Workouts
workouts
--------
id
user_id
workout_date
workout_type
duration_minutes

estimated_calories
manual_calories
final_calories

is_locked
is_deleted

created_at
updated_at
locked_at
59. Activities
activities
----------
id
user_id
activity_date
activity_type
duration_minutes

estimated_calories
manual_calories
final_calories

is_locked
is_deleted

created_at
updated_at
locked_at
60. Steps
steps_entries
-------------
id
user_id
entry_date
steps
is_active

created_at
updated_at

Multiple entries allowed.

Exactly one active/latest value per date.

61. Weight
weight_measurements
-------------------
id
user_id
measurement_date
weight_kg
source
inbody_report_id nullable
created_at

Source:

MANUAL
INBODY
62. InBody
inbody_reports
--------------
id
user_id
report_date
file_path
file_type
extraction_status
raw_extracted_text
created_at

Metrics:

inbody_metrics
--------------
id
report_id
weight_kg
body_fat_percent
muscle_mass_kg
bmi
bmr
other_metrics_json
63. Audit Logs
audit_logs
----------
id
actor_user_id
target_user_id
entity_type
entity_id
action

old_values_json
new_values_json

reason
created_at

Actions:

CREATE
UPDATE
DELETE
RESTORE
LOCK
UNLOCK
PIN_RESET
ROLE_CHANGE
ADMIN_CORRECTION
64. Groups
groups
------
id
name
description
code
creator_id
is_active
created_at

Membership:

group_memberships
-----------------
id
group_id
user_id
role
joined_at
left_at
is_active

Group membership role:

MEMBER
LEADER
ADMIN

Keep group role independent from global RBAC.

65. Security / RLS

RLS is mandatory.

Rules:

User

Can read/write own permitted records.

Cannot access another user's private data.

Manager

Can access assigned users only.

Admin

Can access operational data across users.

Super Admin

Full access.

Group

Can access only permitted group-visible fields of active members.

Do not rely on frontend filtering for security.

Database policies must enforce access.

Supabase's current documentation specifically supports using RLS for this model.

66. Record Locking

Lock condition:

record_date < current_date

for normal users.

But locking should be represented explicitly where useful.

Server-side mutation functions must enforce:

if locked and role == USER:
    reject

Never rely only on disabled UI buttons.

Admin corrections bypass user lock through secure server-side functionality.

67. Analytics Architecture

Do not send every record to AI.

Analytics should be deterministic SQL/application logic.

Create reusable aggregation functions for:

daily nutrition
weekly workouts
monthly averages
target adherence
weight change
body composition change
activity totals
step averages

AI receives only summarized results.

68. Missing Data

Never convert missing data to zero.

Examples:

No food log ≠ 0 calories
No steps ≠ 0 steps
No workout ≠ 0 workouts
No weight ≠ 0 kg

Charts display gaps.

Adherence denominator uses eligible/tracked days.

69. Admin Corrections

Admin can modify locked records.

Example:

Original:
800 kcal

Correction:
1,950 kcal

Store:

original
new
admin
timestamp
reason optional

Then recalculate affected analytics.

Never silently overwrite history.

70. Deleted Records

Use soft deletion.

Fields:

is_deleted
deleted_at
deleted_by
delete_reason

Deleted records excluded from normal analytics.

Keep available for audit/admin inspection.

71. Profile Readiness

Recommendation readiness requires mandatory profile information:

name
age
gender
height
current weight

If missing:

NO RECOMMENDATION AVAILABLE

Complete your profile to receive
personalized recommendations.

Do not fabricate an AI recommendation.

72. Recommendation Failure

If processing fails:

FAILED

Store reason.

Previous recommendation remains active.

Retry only failed users.

Successful users are not reprocessed unless explicitly requested.

73. Processing Failure Isolation

For batch:

User A → SUCCESS
User B → FAILED
User C → SUCCESS
User D → SUCCESS

The batch continues.

User B can later be retried independently.

74. AI Validation

Only basic validation in MVP.

Validate:

required fields
numeric types
reasonable value types
workout days match capacity
required targets exist
valid JSON
valid enum values

Do not build an elaborate AI quality scoring system in MVP.

75. AI Quality

Future:

👍
⚠️
❌

per recommendation.

Not required in MVP.

76. Cost Dashboard

Admin sees:

CURRENT PERIOD

AI REQUESTS
TOKENS
ESTIMATED COST
ACTUAL COST
SUCCESS RATE
FAILED REQUESTS

Also:

BY MODEL
BY PROCESSING RUN
BY USER
77. Settings

System configuration table:

system_settings
---------------
key
value_json
updated_by
updated_at

Potential settings:

nutrition_tolerance
calorie_lower_tolerance
calorie_upper_tolerance
ai_monthly_budget
ai_batch_size
ai_provider
ai_model
recommendation_processing_day
78. Admin Screens

Minimum admin navigation:

Dashboard
Users
Managers
Groups
Food Database
Monthly Processing
AI Usage
Audit Logs
System Settings
Admin dashboard

Show:

Active users
Incomplete profiles
Current recommendation status
AI spend
Pending processing
Failed processing
Food submissions
79. User Management

Admin can:

create user
edit user
deactivate user
reset PIN
assign manager
inspect profile
inspect records
inspect recommendation history
inspect audit history
80. Manager Dashboard

Only assigned users.

Example:

MY USERS

ROHITH
TODAY
1,450 / 2,000 KCAL
105 / 140 G
WORKOUT ✓

USER B
...

No access to unrelated users.

81. PWA

Phase 1 should support:

installable web app
mobile viewport
app icon
splash/launch configuration
offline shell where practical
cached static assets

Do not attempt full offline data synchronization in MVP.

82. Responsive Design

Primary design target:

360px–430px mobile

Also support:

tablet
desktop
large desktop

Desktop should use the same design system but a different composition.

83. Performance

Priorities:

fast initial load
lazy-load large admin screens
query only required columns
pagination for admin tables
virtualized lists only where actually needed
image compression for InBody reports
avoid loading entire histories into browser
use TanStack Query caching
database indexes on frequent filters
84. Important Database Indexes

At minimum:

profiles(user_id)
meals(user_id, meal_date)
meal_items(meal_id)

workouts(user_id, workout_date)
activities(user_id, activity_date)
steps_entries(user_id, entry_date)
weight_measurements(user_id, measurement_date)

recommendation_cycles(user_id, generated_at)
daily_target_snapshots(user_id, target_date)

group_memberships(group_id, user_id)

audit_logs(target_user_id, created_at)
audit_logs(actor_user_id, created_at)

recommendation_processing_users(processing_run_id, status)
85. Frontend Folder Structure

Recommended:

src/
├── app/
│   ├── router/
│   ├── providers/
│   └── layouts/
│
├── components/
│   ├── ui/
│   ├── charts/
│   ├── metrics/
│   ├── forms/
│   └── common/
│
├── features/
│   ├── auth/
│   ├── profile/
│   ├── home/
│   ├── food/
│   ├── workout/
│   ├── activity/
│   ├── progress/
│   ├── groups/
│   ├── recommendations/
│   └── admin/
│
├── lib/
│   ├── supabase/
│   ├── validation/
│   ├── calculations/
│   ├── dates/
│   └── permissions/
│
├── hooks/
├── types/
├── styles/
└── main.tsx

Keep domain logic separate from UI.

86. Backend / Supabase Functions

Suggested functions:

create-user
reset-user-pin

process-monthly-recommendations
process-recommendation-batch
retry-recommendation

create-food-submission
approve-food

admin-correct-record

extract-inbody

calculate-daily-summary

AI functions must remain server-side.

87. Development Phases
Phase 0 — Foundation
Vite
React
TypeScript
Tailwind
Supabase
routing
design tokens
authentication foundation
database migrations
RLS foundation
Phase 1 — Core User
login
onboarding
profile
Home
Food
Workout
Activity
Steps
Weight
Phase 2 — Progress
charts
target snapshots
adherence calculations
cycle summaries
Phase 3 — Groups
create
join
leave
member cards
permissions
Phase 4 — Admin
user management
food database
corrections
audit
manager assignments
Phase 5 — InBody
upload
extraction
structured metrics
body composition history
Phase 6 — AI
processing runs
summary generation
AI provider
batching
budget
structured recommendations
review/lock
Phase 7 — PWA / Polish
installation
responsive refinement
performance
animations
accessibility
error states
loading states
88. Implementation Order

Do not start by building every screen visually.

Recommended order:

1. Database schema
2. RLS
3. Auth
4. Design system
5. App shell
6. Profile/onboarding
7. Home
8. Food
9. Workout
10. Activity
11. Steps/weight
12. Progress
13. Groups
14. Admin
15. InBody
16. Recommendation engine
17. AI processing
18. PWA
19. Testing
20. Visual polish
89. Acceptance Criteria

The MVP is not considered complete until:

Authentication
admin can create users
user can log in
PIN reset works
unauthorized data cannot be accessed
Profile
mandatory fields enforced
incomplete profile clearly identified
recommendations blocked when required information is missing
Food
food can be selected
quantities work
nutrition snapshot is created
meals can be copied
edit window works
locked meals cannot be edited by users
admin corrections work
Workout
workouts can be logged
calories calculated
manual override works
weekly completion works
calendar weeks are Monday–Sunday
Activity
activity can be logged
calories calculated
manual override works
activity has no artificial target
Steps
multiple entries work
latest value becomes active
Weight
manual measurements work
InBody measurements integrate into weight history
Recommendations
cycles work
target snapshots work
review window works
user edits preserve AI originals
old plan remains active until new plan exists
AI
batching works
individual failures don't stop processing
budget limit works
successful users are not unnecessarily reprocessed
tokens/cost/model are recorded
Groups
join by code
leave
remove member
correct visibility
historical access restrictions work
Admin
corrections work
audit records are generated
managers only see assigned users
90. Non-Goals — Phase 1

Do NOT build:

exercise set/rep tracking
workout weight progression
phone health integration
smartwatch integration
calorie barcode scanning
advanced micronutrient tracking
meal templates
social feed
comments
likes
leaderboard
ranking
gamification
streak obsession
real-time AI chat
complex organization hierarchy
payments
native mobile app
automated AI quality scoring

These can be considered later.

91. Product Safety / Communication

The application must not claim that recommendations guarantee health or fitness outcomes.

AI-generated recommendations should be presented as:

Guidance based on the available information.

Nutrition and training recommendations should not be presented as medical diagnosis.

Where appropriate:

Consult a qualified healthcare or fitness professional for personalized professional advice.

Do not make the application unnecessarily alarmist.

92. Critical Design Rule

The coding agent must NOT turn the application into a generic dashboard.

Avoid:

card
card
card
card
card
card

Instead use:

large metric
        ↓
progress
        ↓
compact data rows
        ↓
meaningful block
        ↓
action

The UI should feel deliberately designed.

93. Core Home UX Test

A user opening Home should understand within approximately 10–20 seconds:

Calories:      how am I doing?
Protein:       am I close?
Workout:       did I train?
Steps:         how active was I?
Next action:   what should I do?

If a UI element doesn't help answer one of those questions, question whether it belongs on Home.

94. Core Progress UX Test

Progress should answer:

Is my body changing?
Am I eating consistently?
Am I training consistently?
What changed recently?
What should I pay attention to?

Do not show charts merely because data exists.

95. Core Product Principle

The system should be:

Data-rich underneath. Insight-rich on top.

The database can contain thousands of records.

The user interface should show only the information that helps the user understand their current state.

96. Coding Agent Behaviour

The coding agent must:

Follow the specification before making implementation decisions.
Avoid introducing unnecessary libraries.
Keep business logic out of presentation components.
Use TypeScript strictly.
Use Zod for external/user/AI input validation.
Use server-side validation for privileged operations.
Never expose AI API keys.
Never bypass RLS from the browser.
Preserve historical snapshots.
Never silently overwrite audit-sensitive records.
Write database migrations instead of manually modifying production schema.
Add indexes intentionally.
Add loading, empty, error and locked states.
Build mobile-first.
Test permissions.
Test date/cycle boundaries.
Test Monday–Sunday workout calculations.
Test recommendation transition weeks.
Test AI budget exhaustion.
Do not add features that are outside MVP without explicit approval.
97. Final Visual Instruction to Coding Agent

The UI should resemble:

A premium personal performance dashboard with the information density and visual confidence of a modern trading dashboard, the calmness of a health application, and subtle brutalist/terminal influence.

Use the selected Dribbble references as visual inspiration only.

Do not reproduce their designs.

Prioritize:

hierarchy
spacing
typography
data visualization
icons
contrast
simplicity

over decorative effects.

The application should feel:

smart · calm · distinctive · athletic · technical · premium

and never:

busy · childish · gamified · noisy · generic · neon · corporate SaaS

98. Definition of Done

The MVP is ready for the first friend-group test when:

users can log in
users can complete profiles
users can log food/workouts/activities/steps/weight
historical records lock correctly
nutrition snapshots remain historically accurate
Home gives a useful daily overview
Progress provides meaningful deterministic analysis
groups work with correct privacy
admins can correct data with audit history
managers only see assigned users
monthly recommendation cycles work
AI processing is budget-controlled
recommendations can be reviewed and locked
the application works well on mobile
PWA installation works
the visual design consistently follows the approved design system
no major permission or historical-data bugs remain
99. Guiding Statement

The application should never try to make the user feel that they are "winning" because they opened the app.

It should help them understand:

What happened.
How consistent I was.
What changed.
What matters next.

That is the product.