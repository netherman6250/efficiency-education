# Start here — exact click-by-click setup (for total beginners)

Everything below is free. Do one numbered line at a time. Two secret values you'll
need (keep them in a notes app, NEVER type them into a file here):
- **Admin setup secret** — the random string Claude gave you in chat.
- **Stripe secret key** — see the box in Part E.

---

## Part A — Make a GitHub account (skip if you already have one)

1. Open **Google Chrome**.
2. Click the address bar at the top, type `github.com`, press **Enter**.
3. Click **Sign up** (top-right corner).
4. Enter your email, make a password and username, and follow the prompts.
5. Check your email inbox for a code from GitHub and enter it to verify.

## Part B — Create the project on GitHub

6. Now signed in, look at the **top-right** for a **+** icon. Click it.
7. Click **New repository**.
8. In the **Repository name** box, type: `efficiency-education`
9. Leave everything else as-is. Do **not** tick "Add a README file".
10. Click the green **Create repository** button.

## Part C — Upload your files (drag from File Explorer)

11. On the page that appears, find the sentence with a blue link
    **"uploading an existing file"** and click it.
    (No link? Click the **Add file** button → **Upload files**.)
12. Leave that Chrome tab open. Now open **File Explorer**: press the
    **Windows key + E** together (or click the yellow folder on the taskbar).
13. Click the **address bar** at the top of File Explorer, type this exactly and
    press **Enter**:
    `C:\Users\turne\Documents\efficiency-education`
14. You should see: `study-studio.html`, `netlify.toml`, `package.json`,
    `SETUP.md`, `START-HERE.md`, and a **folder** named `netlify`.
15. Click once in the file area, then press **Ctrl + A** to select everything
    (all items turn blue, including the `netlify` folder).
16. Press and hold the mouse on the selected items, **drag** them over to the
    Chrome window, onto the big box that says "Drag files here", and let go.
17. Wait a few seconds. GitHub lists all the files (you'll see `netlify/functions/…`
    appear too). Scroll to the bottom.
18. Click the green **Commit changes** button.

## Part D — Put it online with Netlify

19. Open a **new Chrome tab**, type `netlify.com`, press **Enter**.
20. Click **Sign up**, then choose **Sign up with GitHub** (easiest), and click
    **Authorize** if asked.
21. On the Netlify dashboard, click **Add new site** → **Import an existing project**.
22. Click **Deploy with GitHub**. Authorize again if asked.
23. In the list, click **efficiency-education**.
24. Do **not** change any settings. Click the **Deploy** button.
25. Wait 1–2 minutes until it says **Published**.
26. (Optional) To get the address `efficiencyeducation.netlify.app`: click
    **Site configuration** → **Change site name** → type `efficiencyeducation` → Save.

## Part E — Add your secret settings

27. In Netlify, with your site open, click **Site configuration** (left menu).
28. Click **Environment variables**.
29. Click **Add a variable** → **Add a single variable**. Do this **four times** —
    for each row below, type the Key exactly, paste the Value, click **Create variable**:

    | Key                      | Value                                              |
    | ------------------------ | -------------------------------------------------- |
    | `STRIPE_SECRET_KEY`      | your Stripe key (starts with `sk_test_`)           |
    | `RESEND_API_KEY`         | your Resend key (get it in Part F)                 |
    | `MAIL_FROM`              | `Efficiency Education <onboarding@resend.dev>`     |
    | `ADMIN_BOOTSTRAP_SECRET` | the random string Claude gave you in chat          |

    > **Where's my Stripe secret key?** Go to `dashboard.stripe.com`, make sure
    > the **Test mode** switch (top-right) is ON, then **Developers → API keys →
    > Secret key → Reveal**. It starts with `sk_test_`. (You already made the four
    > Payment Links; this is a different value.)

30. After all four are added, click **Deploys** (left menu) → **Trigger deploy**
    → **Deploy site**. This restarts the site with your new settings.

## Part F — Get the Resend email key

31. New Chrome tab → `resend.com` → **Sign up** (free).
32. In Resend, click **API Keys** (left) → **Create API Key** → give it any name →
    **Add**.
33. Copy the key it shows you now (you only see it once).
34. Go back to Netlify (Part E, step 29) and paste it as the value of
    `RESEND_API_KEY`. Then do step 30 again to re-deploy.

## Part G — Switch on your admin account (once)

35. Open your live site (the Netlify address).
36. Sign in using your admin email: `arthurmmturner2@` followed by your usual
    domain.
37. It asks for a **Setup secret** — paste the random string Claude gave you.
38. Choose an admin password (at least 6 characters), type it again to confirm,
    and click **Set password & sign in**. Done — that's a one-time step.

## Part H — Test it (Stripe sandbox, no real money)

39. Sign out, then sign in with a normal test email (not the admin one).
40. Choose a plan → on the Stripe page, pay with card `4242 4242 4242 4242`,
    any future expiry date, any 3-digit CVC.
41. You return to the site and premium unlocks.
42. Open the site in a **private/incognito window** (Chrome: **Ctrl + Shift + N**),
    sign in with the **same** email → premium is locked and a 6-digit code is
    emailed → enter it → premium unlocks. That's the new-device protection working.
43. In Stripe, cancel that test subscription → reload the site → premium drops.

---

When everything works in test mode, Part 7 of `SETUP.md` covers flipping to real
money. Stuck on any single step? Tell Claude the step number and what you see.
