# Airborne Aviation CRM & Admin OS (`airborne-admin`)

This is the dedicated management and operations portal for **Airborne Aviation**.

---

## 🌐 Cloud Run Production Service
- **Service Name:** `airborne-admin`
- **GCP Project:** `airborne-aviation-505100`
- **Region:** `asia-south1`
- **Live Production URL:** [https://airborne-admin-368523757732.asia-south1.run.app](https://airborne-admin-368523757732.asia-south1.run.app)
- **Health Check Endpoint:** `/health/ready`

---

## 📁 Key Modules & Routes

| Module | Route | Purpose |
|---|---|---|
| **Leads & Inquiries** | `/leads` | Complete lead pipeline, status tracking, duplicate protection (409) |
| **Admissions** | `/admissions` | Student application processing and intake verification |
| **Students & LMS** | `/students`, `/lms` | Enrolled batch management, schedules, training records |
| **Fee Plans & Payments** | `/fee-plans`, `/payments` | Fee structure, invoicing, ledger balance |
| **WhatsApp Automation** | `/whatsapp` | Interakt-based nurture campaigns & automated messaging |
| **CMS & Dynamic Web** | `/cms`, `/blog` | Homepage banners, reviews, course metadata, and blog editor |
| **Job Applications** | `/jobs` | Inbound aviation career applications and status review |
| **Settings & Users** | `/settings`, `/users` | RBAC permissions, API integration keys, system config |

---

## 🚀 Running Locally

1. **Install Dependencies (if not already copied):**
   ```bash
   npm install
   ```

2. **Generate Prisma Client:**
   ```bash
   npx prisma generate
   ```

3. **Environment Setup:**
   Ensure `.env` or `.env.local` contains valid database credentials (`DATABASE_URL`, `DIRECT_URL`).

4. **Start Development Server:**
   ```bash
   npm run dev
   ```
   The CRM will run locally at: `http://localhost:4000`

---

## 🚢 Docker Build (Matches Cloud Run)
```bash
docker build -t airborne-admin .
docker run -p 4000:8080 airborne-admin
```
