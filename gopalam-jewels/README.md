This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
# Authentication setup

Authentication uses a 10-hour signed session stored in an HttpOnly cookie. Configure these server-side environment variables locally and in Vercel:

- `MONGO_URI`: existing MongoDB connection string
- `AUTH_SECRET`: a cryptographically random value of at least 32 characters
- `GMAIL_SMTP_USER`: Gmail address used to send password-reset emails
- `GMAIL_APP_PASSWORD`: 16-character Google App Password for the sending Gmail account
- `INITIAL_ADMIN_PASSWORD`: used only while running the one-time seed command; do not keep it configured in the deployed application

Keep the existing `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` variable for image delivery. Generate an auth secret with a secure password/secret generator or `openssl rand -base64 48`.

## Create the initial admin

Set `MONGO_URI` and set `INITIAL_ADMIN_PASSWORD` to the supplied initial password in your local environment, then run:

```bash
npm run seed:admin
```

The script creates `admin` with email `gopalamgems@gmail.com`, role `admin`, and an active status. It is idempotent and never overwrites an existing admin. Remove `INITIAL_ADMIN_PASSWORD` after seeding.

Future users can be inserted into the `users` collection with the same fields and a bcrypt hash produced with cost 12. Usernames have a unique index; email has a non-unique lookup index so a business may intentionally share one reset mailbox across multiple accounts.

Gmail SMTP requires 2-Step Verification and a Google App Password. Use an App Password rather than the Gmail account's normal password. Password reset email fails safely—and leaves the current password unchanged—when Gmail delivery fails.
