# Gather — Workshop Registration Service API (`WR-Server`)

The enterprise-grade, transactional backend service powering the **Gather** Workshop Registration application. Built with NestJS, Express, and MongoDB Atlas with native multi-document ACID transactions.

- **Frontend Repository:** [Thisara404/WR-Client](https://github.com/Thisara404/WR-Client)
- **Live Application:** [https://gather-seven-mocha.vercel.app/](https://gather-seven-mocha.vercel.app/)

---

## Architecture & Modular Structure

The codebase is organized into modular domain directories for maintainability, clarity, and separation of concerns:

```
backend/src/
├── common/                  # Shared utilities, validation schemas & global exception filters
│   ├── http-error.filter.ts # Sanitized JSON errors (Zod validation, MongoDB codes, HTTP statuses)
│   ├── validation.ts        # Strict Zod schemas for all request payloads, query params & UUIDs
│   └── index.ts
├── controllers/             # Clean HTTP route controllers
│   ├── auth.controller.ts   # Rate-limited authentication (/api/auth/login, /me, /logout)
│   ├── users.controller.ts  # Admin account creation & audit listings (/api/users)
│   ├── workshops.controller.ts # Workshop catalog, registrations & cancellations (/api/workshops)
│   └── index.ts
├── models/                  # Mongoose schemas, types & index specifications
│   ├── models.ts            # User, Workshop, Registration, Event, Audit, LoginLimit
│   └── index.ts
├── security/                # Cryptography, authentication guards & RBAC
│   ├── password.ts          # Salted scrypt password hashing & timingSafeEqual comparison
│   ├── security.ts          # AuthGuard, RolesGuard, WriteGuard & JWT session signing
│   └── index.ts
├── services/                # Business logic & database operations
│   ├── database.service.ts  # Connection pooling & withTransaction helper
│   ├── workshops.service.ts # Atomic registration, seat claims, cancellation & audits
│   └── index.ts
├── app.module.ts            # Root NestJS application module
├── bootstrap.ts             # Express & CORS middleware configuration
└── main.ts                  # Local server startup entrypoint
```

---

## Critical Technical Feature: Preventing Over-Registration

Preventing over-booking during concurrent ticket rushes is the core challenge addressed in this backend:

### 1. MongoDB Multi-Document ACID Transactions
All registration operations run inside a MongoDB transaction with **Snapshot Read Concern** (`readConcern: "snapshot"`) and **Majority Write Concern** (`writeConcern: "majority"`). If any write in the chain fails or a conflict occurs, all database operations roll back completely.

### 2. Conditional Atomic Seat Increment
Instead of performing an unsafe "check-then-update" (which creates race conditions), the backend executes an atomic conditional update on the `Workshop` document:
```typescript
const updated = await this.models.Workshop.findOneAndUpdate(
  {
    _id: workshopId,
    status: "SCHEDULED",
    startsAt: { $gt: new Date() },
    $expr: { $lt: ["$activeCount", "$capacity"] },
  },
  { $inc: { activeCount: 1 } },
  { session, new: true },
);

if (!updated) {
  throw new ConflictException("Workshop is at full capacity or is no longer open for booking");
}
```
If two simultaneous requests arrive with only 1 seat remaining, MongoDB locks the document at the database level. One transaction successfully claims the seat; the second transaction fails the `$expr` condition and is cleanly rejected with a 409 Conflict. No in-memory locks or single-node mutexes are used, ensuring **horizontal scalability across serverless instances**.

### 3. Duplicate Active Booking Prevention
A compound partial unique index on the `Registration` collection enforces that the same attendee email cannot hold two active seats in the same workshop:
```typescript
registrationSchema.index(
  { workshopId: 1, email: 1 },
  { unique: true, partialFilterExpression: { status: "CONFIRMED" } }
);
```
Cancelled attendees can re-register in the future, but double-booking is physically prevented at the database engine level.

### 4. Idempotency & Lost Response Protection
Each registration request includes a unique client-generated `requestId` (UUIDv4). If a client encounters a network drop and retries the request, the backend detects the existing `requestId`, replays the existing confirmed registration, and returns HTTP `200` without claiming an extra seat.

### 5. Optimistic Concurrency on Capacity Edits
When a Manager updates workshop details (e.g., lowering capacity), the update requires an optimistic version check (`version: currentVersion`) and verifies that `newCapacity >= activeCount`. This guarantees an admin/manager cannot accidentally reduce capacity below existing confirmed attendee counts.

---

## Security & Protection Measures

- **Password Security:** Passwords use cryptographic salted `scrypt` hashing with a minimum 16-byte random salt and `crypto.timingSafeEqual` to eliminate timing attacks.
- **Session Tokens:** Stateless, signed HMAC-SHA256 JWT sessions stored in `HttpOnly`, `SameSite=Lax` cookies.
- **Login Rate Limiting:** Backed by MongoDB with a 15-minute TTL (`LoginLimit` collection) to prevent credential stuffing and brute-force attacks across all instances.
- **Request Body Limits:** Hard 32 KB payload limit via Express body parser to defend against memory exhaustion and payload DOS attacks.
- **ReDoS / NoSQL Sanitization:** Query parameters and string inputs sanitize special regex operators to block ReDoS and NoSQL operator injection.
- **Strict Role-Based Access Control (RBAC):**
  - `Admin`: Can create accounts and view account audits. Blocked from workshops and attendee data.
  - `Manager`: Can manage workshops, edit capacity, register attendees, cancel bookings. Cannot create accounts.
  - `Staff`: Can register attendees, cancel bookings, view catalog and rosters. Cannot create accounts or edit workshops.

---

## API Reference

| Method & Route | Access Level | Description |
| :--- | :--- | :--- |
| `POST /api/auth/login` | Public | Authenticates credentials; sets HttpOnly cookie |
| `GET /api/auth/me` | Authenticated | Restores current active user session |
| `POST /api/auth/logout` | Authenticated | Clears session cookie |
| `GET /api/users` | Admin | Lists user accounts with creator details |
| `POST /api/users` | Admin | Creates a new Staff or Manager account |
| `GET /api/workshops` | Manager, Staff | Lists workshops with date/location/availability filters |
| `GET /api/workshops/:id` | Manager, Staff | Workshop details, attendee list & full event history |
| `POST /api/workshops` | Manager | Creates a new workshop |
| `PATCH /api/workshops/:id` | Manager | Updates workshop (versioned concurrency check) |
| `POST /api/workshops/:id/registrations` | Manager, Staff | Atomically reserves a seat and registers attendee |
| `POST /api/registrations/:id/cancel` | Manager, Staff | Cancels active registration and frees seat |
| `GET /api/health` | Public | MongoDB ping healthcheck |

---

## Local Setup & Development

### 1. Prerequisites
- Node.js `v22.12.0` or higher
- A MongoDB Atlas cluster (Replica Set / Atlas M0+ with transactions enabled)

### 2. Installation
```bash
git clone https://github.com/Thisara404/WR-Server.git
cd WR-Server
npm install
```

### 3. Environment Configuration
Create a `.env` file in the `backend` directory (refer to `.env.example`):
```dotenv
PORT=3001
MONGODB_URI="mongodb+srv://<USER>:<PASSWORD>@<CLUSTER>.mongodb.net/workshop_assessment?retryWrites=true&w=majority"
SESSION_SECRET="generate-a-random-64-char-hex-string"
FRONTEND_URL="http://localhost:5173,https://gather-seven-mocha.vercel.app"
SEED_ADMIN_PASSWORD="AdminPractice123!"
SEED_MANAGER_PASSWORD="ManagerPractice123!"
SEED_STAFF_PASSWORD="StaffPractice123!"
```

### 4. Database Seeding
Creates collections, unique indexes, initial Admin, demo Manager/Staff accounts, and four future workshops:
```bash
npm run db:seed
```

### 5. Running the API
```bash
# Development mode with hot-reloading
npm run dev

# Static type check & lint
npm run lint

# Run unit tests
npm test

# Run Atlas integration test suite (20 concurrent bookings against 2 seats)
npm run test:atlas

# Build for production
npm run build
```

---

## Demonstration Logins

| Role | Email | Password |
| :--- | :--- | :--- |
| **Admin** | `admin@workshop.local` | `AdminPractice123!` |
| **Manager** | `manager@workshop.local` | `ManagerPractice123!` |
| **Staff** | `staff@workshop.local` | `StaffPractice123!` |
