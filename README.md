# Simple Contact Site

This project is a small contact form with a Node/Express backend that sends form submissions via email. For development, if you don't configure SMTP, the server will use an Ethereal test account (no real emails are sent). The Ethereal preview URL will be returned after submitting.

## Quick start

1. Install Node.js (LTS) from https://nodejs.org/
2. In PowerShell or terminal, from the project folder:

```powershell
npm install
npm start
```

3. Open http://localhost:3000 and submit the form.

## Configuration

Copy `.env.example` to `.env` and set SMTP variables if you want to send real emails.

To add a logo image, place your `warboy.png` file in the `resources/` folder at the project root (create the folder if needed). The file will be served at `/resources/warboy.png` and displayed above the Name/Email form. The image will render on a black background for a bold, high-contrast look.

The site now collects sign-ups for a drop list. When users opt in (consent), their email and name are stored in `subscribers.json`.

Admin endpoints (protect with `ADMIN_TOKEN` in your `.env`):

- `GET /subscribers` — list consenting subscribers (requires `x-admin-token` header)
- `POST /admin/announce` — send an announcement email to all consenting subscribers (requires `x-admin-token` header). Send `subject` and `message` (or `html`) in the JSON body.

**Security:** Set `ADMIN_TOKEN` to a strong secret in `.env` before using admin endpoints. These endpoints are not authenticated beyond the token; do not expose them publicly without additional protections.

## Notes

- Submissions are appended to `submissions.log` and consenting subscribers are stored in `subscribers.json`.
- For production, configure a real SMTP provider and secure your server (HTTPS, CORS, proper auth for admin endpoints, rate limiting, CAPTCHA etc.).
