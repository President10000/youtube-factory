const fs = require("fs");
const { chromium } = require("playwright");

(async () => {
  const args = process.argv.slice(2);
  const channelIndex = args.indexOf("--channel");
  const formatIndex = args.indexOf("--format");

  if (channelIndex === -1) {
    console.error("Error: --channel argument missing.");
    process.exit(1);
  }

  const channel = args[channelIndex + 1];
  const format = formatIndex !== -1 ? args[formatIndex + 1] : "short";
  const videoFile = `${channel}_output.mp4`;

  console.log(`Starting headless upload for ${channel} (Format: ${format})...`);

  const rawCookies = process.env.YOUTUBE_COOKIE;
  if (!rawCookies) {
    console.error("Error: YOUTUBE_COOKIE secret is missing.");
    process.exit(1);
  }

  let rawParsedCookies = JSON.parse(rawCookies);

  // Force array format
  if (!Array.isArray(rawParsedCookies)) {
    if (rawParsedCookies.cookies && Array.isArray(rawParsedCookies.cookies)) {
      rawParsedCookies = rawParsedCookies.cookies;
    } else {
      rawParsedCookies = [rawParsedCookies];
    }
  }

  // STRICT COOKIE SANITIZER FOR PLAYWRIGHT
  const cookies = rawParsedCookies.map((cookie) => {
    if (cookie.sameSite === "no_restriction") {
      cookie.sameSite = "None";
    } else if (
      cookie.sameSite === "unspecified" ||
      !["Strict", "Lax", "None"].includes(cookie.sameSite)
    ) {
      delete cookie.sameSite;
    }
    return cookie;
  });

  let metadata = { title: "New Video", description: "", hashtags: "" };
  try {
    const rawMetadata = fs.readFileSync("metadata.json", "utf8");
    metadata = JSON.parse(rawMetadata);
  } catch (err) {
    console.warn(
      "Warning: Could not read metadata.json, using fallback metadata.",
    );
  }

  const fullDescription = metadata.hashtags
    ? `${metadata.description}\n\n${metadata.hashtags}`
    : metadata.description;

  const browser = await chromium.launch({ headless: true });

  // Realistic User-Agent to bypass Google Security
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  console.log("Warming up session on main YouTube page...");
  await page.goto("https://www.youtube.com");

  // Inject sanitized cookies while on the correct domain
  await context.addCookies(cookies);

  // Reload the page so YouTube reads the cookies and logs you in
  await page.reload();
  await page.waitForTimeout(3000);

  console.log("Accessing YouTube Studio...");
  await page.goto("https://studio.youtube.com");

  // Wait 5 seconds to allow any automatic redirects or popups to settle
  await page.waitForTimeout(5000);

  const currentUrl = page.url();
  const pageTitle = await page.title();

  console.log(`Current URL: ${currentUrl}`);
  console.log(`Page Title: ${pageTitle}`);

  if (
    currentUrl.includes("accounts.google.com") ||
    currentUrl.includes("signin")
  ) {
    console.error(
      "CRITICAL ERROR: Google rejected your cookies and redirected to the login page.",
    );
    console.error(
      "This usually means the cookies expired, or Google flagged the GitHub Actions server IP as suspicious. Check your Google account security alerts and export fresh cookies.",
    );
    process.exit(1);
  }

  console.log(`Successfully authenticated into YouTube Studio for ${channel}.`);

  // 1. Handle "Welcome to YouTube Studio" popup for new channels
  console.log("Checking for 'Welcome to YouTube Studio' popups...");
  try {
    const continueBtn = page
      .locator(
        'ytcp-button:has-text("CONTINUE"), ytcp-button:has-text("Continue")',
      )
      .first();
    await continueBtn.waitFor({ state: "visible", timeout: 5000 });
    console.log("Found Welcome popup. Clicking Continue...");
    await continueBtn.click();
    await page.waitForTimeout(2000);
  } catch (e) {
    console.log("No Welcome popup detected.");
  }

  // 2. Clear any other potential UI blockers
  console.log("Clearing potential popups...");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1000);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1000);

  console.log(`Uploading ${videoFile}...`);

  // 3. Resilient clicker: Looks for the Create Button, Upload Icon, OR Empty Channel Upload Button
  const createBtn = page
    .locator("#create-icon, #upload-icon, #upload-button")
    .first();
  await createBtn.waitFor({ state: "attached", timeout: 30000 });
  await createBtn.click({ force: true });

  await page.waitForTimeout(2000);

  // 4. Only click the dropdown menu if it is required (some buttons skip straight to the modal)
  try {
    const uploadMenuItem = page.locator(
      'tp-yt-paper-item:has-text("Upload videos")',
    );
    await uploadMenuItem.waitFor({ state: "visible", timeout: 5000 });
    await uploadMenuItem.click({ force: true });
  } catch (e) {
    console.log("Dropdown menu not needed. Modal likely already open.");
  }

  console.log("Waiting for file input to appear...");
  await page.waitForSelector('input[type="file"]', { timeout: 30000 });
  await page.locator('input[type="file"]').setInputFiles(videoFile);

  await page.waitForSelector("#title-textarea", { timeout: 60000 });

  console.log("Entering metadata...");
  await page.locator("#title-textarea #textbox").clear();
  await page.locator("#title-textarea #textbox").fill(metadata.title);

  await page.locator("#description-textarea #textbox").clear();
  await page.locator("#description-textarea #textbox").fill(fullDescription);

  if (format === "long") {
    console.log("Uploading thumbnail.jpg...");
    await page
      .locator('input[id="file-loader"]')
      .setInputFiles("thumbnail.jpg");
  }

  await page
    .locator('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]')
    .click();

  console.log("Proceeding through upload wizard...");
  await page.locator("#next-button").click();
  await page.locator("#next-button").click();
  await page.locator("#next-button").click();

  console.log("Setting visibility to Public...");
  await page.locator('tp-yt-paper-radio-button[name="PUBLIC"]').click();

  console.log("Publishing video...");
  await page.locator("#done-button").click();

  await page.waitForSelector(
    "ytcp-video-share-dialog, ytcp-uploads-still-processing-dialog",
    { timeout: 120000 },
  );
  console.log("Upload completed successfully!");

  await browser.close();
})();
