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

  // Load YouTube session cookies from GitHub Secrets
  const rawCookies = process.env.YOUTUBE_COOKIE;
  if (!rawCookies) {
    console.error("Error: YOUTUBE_COOKIE secret is missing.");
    process.exit(1);
  }

  let cookies = JSON.parse(rawCookies);

  // Force the object into an array format required by Playwright
  if (!Array.isArray(cookies)) {
    // If the secret comes from an extension that nests the array inside an object
    if (cookies.cookies && Array.isArray(cookies.cookies)) {
      cookies = cookies.cookies;
    } else {
      // Wrap the single object in an array
      cookies = [cookies];
    }
  }

  // Load AI-generated Metadata
  let metadata = { title: "New Video", description: "", hashtags: "" };
  try {
    const rawMetadata = fs.readFileSync("metadata.json", "utf8");
    metadata = JSON.parse(rawMetadata);
  } catch (err) {
    console.warn(
      "Warning: Could not read metadata.json, using fallback metadata.",
    );
  }

  // Combine description and hashtags with spacing
  const fullDescription = metadata.hashtags
    ? `${metadata.description}\n\n${metadata.hashtags}`
    : metadata.description;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies(cookies);

  const page = await context.newPage();
  console.log("Accessing YouTube Studio...");

  await page.goto("https://studio.youtube.com");
  console.log(`Successfully authenticated into YouTube Studio for ${channel}.`);

  // 1. Initiate Upload
  console.log(`Uploading ${videoFile}...`);
  await page.locator("#create-icon").click();
  await page.locator('tp-yt-paper-item:has-text("Upload videos")').click();

  // Inject the video file into the hidden input
  await page.locator('input[type="file"]').setInputFiles(videoFile);

  // Wait for the details modal to load
  await page.waitForSelector("#title-textarea", { timeout: 60000 });

  // 2. Fill Details
  console.log("Entering metadata...");
  await page.locator("#title-textarea #textbox").clear();
  await page.locator("#title-textarea #textbox").fill(metadata.title);

  await page.locator("#description-textarea #textbox").clear();
  await page.locator("#description-textarea #textbox").fill(fullDescription);

  // 3. Upload Thumbnail (Only for Long Format)
  if (format === "long") {
    console.log("Uploading thumbnail.jpg...");
    // Target the hidden file input used for custom thumbnails
    await page
      .locator('input[id="file-loader"]')
      .setInputFiles("thumbnail.jpg");
  }

  // 4. Audience Settings (Not Made for Kids)
  await page
    .locator('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]')
    .click();

  // 5. Navigate through the Wizard
  console.log("Proceeding through upload wizard...");
  await page.locator("#next-button").click(); // Moves to Elements
  await page.locator("#next-button").click(); // Moves to Checks
  await page.locator("#next-button").click(); // Moves to Visibility

  // 6. Set to Public and Publish
  console.log("Setting visibility to Public...");
  await page.locator('tp-yt-paper-radio-button[name="PUBLIC"]').click();

  console.log("Publishing video...");
  await page.locator("#done-button").click();

  // Wait for the completion dialog to confirm the upload is secured
  await page.waitForSelector(
    "ytcp-video-share-dialog, ytcp-uploads-still-processing-dialog",
    { timeout: 120000 },
  );
  console.log("Upload completed successfully!");

  await browser.close();
})();
