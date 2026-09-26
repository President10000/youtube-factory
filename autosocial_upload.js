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
  const context = await browser.newContext();

  // Inject sanitized cookies
  await context.addCookies(cookies);

  const page = await context.newPage();
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

  console.log(`Uploading ${videoFile}...`);
  await page.locator("#create-icon").click();
  await page.locator('tp-yt-paper-item:has-text("Upload videos")').click();

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
