# Trend Radar (Monorepo)

Trend Radar เป็นระบบสำหรับรวบรวม วิเคราะห์ และคาดการณ์แนวโน้ม (Trends)
โครงสร้างเป็น Monorepo โดยใช้ pnpm workspaces และ TurboRepo

Components
- apps/api : Backend API (NestJS + Prisma + PostgreSQL)
- packages/core : Shared types / shared logic (@core)
- docker-compose.yml : PostgreSQL สำหรับ local development
- turbo.json : Turbo task pipeline

System Requirements
- Node.js >= 20
- pnpm
- Docker + Docker Compose

macOS Setup
1) Install Docker Desktop  
https://www.docker.com/products/docker-desktop/

ตรวจสอบ
docker --version  
docker compose version  

2) Install Node.js (via nvm)
brew install nvm  
nvm install 20  
nvm use 20  
node -v  

3) Install pnpm
npm install -g pnpm  
pnpm -v  

Windows Setup
1) Install Docker Desktop for Windows  
2) Install Node.js >= 20  
3) Install pnpm  
npm install -g pnpm  

Linux Setup
1) Install Docker Engine + Docker Compose  
2) Install Node.js >= 20  
3) Install pnpm  

Quick Start
หลังจาก clone repository แล้ว

pnpm bootstrap

คำสั่งนี้จะ:
- ติดตั้ง dependencies ทั้งหมด
- สตาร์ท PostgreSQL ด้วย Docker
- prisma generate
- prisma migrate dev

Manual Setup
pnpm install  
cp apps/api/.env.example apps/api/.env  
pnpm db:up  
pnpm prisma:generate  
pnpm prisma:migrate  
pnpm dev  

Common Commands
pnpm dev  
pnpm build  
pnpm lint  

pnpm db:up  
pnpm db:down  

pnpm prisma:generate  
pnpm prisma:migrate  

Environment Variables
ไฟล์ที่ต้องมี
apps/api/.env

ตัวอย่าง
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/trend_radar?schema=public"

หมายเหตุ
- .env ไม่ถูก commit ขึ้น Git
- ใช้ .env.example เป็น template สำหรับเครื่องใหม่

Project Structure
.
├─ apps/
│  └─ api/
│     ├─ prisma/
│     └─ src/
├─ packages/
│  └─ core/
│     ├─ src/
│     └─ dist/
├─ docker-compose.yml
├─ pnpm-workspace.yaml
├─ turbo.json
├─ package.json
└─ README.md

Development Notes
- ใช้ Docker เพื่อให้ environment ของ database เหมือนกันทุกเครื่อง
- @core เป็น workspace package และต้อง build ก่อน api
- Turbo จัดลำดับ build ให้อัตโนมัติ
- หลัง clone ต้องรัน prisma generate เสมอ

Troubleshooting
docker: command not found  
Docker Desktop ยังไม่ได้ติดตั้ง

Cannot connect to Docker daemon  
Docker Desktop ยังไม่เปิด

port 5432 already in use  
มี PostgreSQL รันอยู่แล้วบนเครื่อง

Prisma error: DATABASE_URL not found  
ยังไม่ได้สร้าง apps/api/.env

License
Private / Internal use only
