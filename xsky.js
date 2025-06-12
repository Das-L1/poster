const { TwitterApi } = require('twitter-api-v2');
const { BskyAgent, RichText } = require('@atproto/api');
const fs = require('fs');
const path = require('path');

// --- Configuration ---
// IMPORTANT: For production applications, store these securely using environment variables
// or a secret management system, NOT hardcoded.

// X (Twitter) API Keys
const X_APP_KEY = 'YOUR_X_APP_KEY';
const X_APP_SECRET = 'YOUR_X_APP_SECRET';
const X_ACCESS_TOKEN = 'YOUR_X_ACCESS_TOKEN';
const X_ACCESS_SECRET = 'YOUR_X_ACCESS_SECRET';

// Bluesky API Credentials
const BSKY_IDENTIFIER = 'YOUR_BLUESKY_HANDLE_OR_EMAIL'; // e.g., 'yourhandle.bsky.social' or 'you@example.com'
const BSKY_PASSWORD = 'YOUR_BLUESKY_APP_PASSWORD'; // Use an app password, NOT your main account password

// Image search path
const IMAGE_FOLDER = path.join(__dirname, 'src');
const IMAGE_BASENAME = 'latest';

// Maximum upload size limits (in bytes)
// X (Twitter) typically allows up to 5MB for static images (5 * 1024 * 1024 bytes)
// Bluesky (AT Protocol) typically allows up to 1MB per image (1 * 1024 * 1024 bytes)
const X_MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const BSKY_MAX_IMAGE_SIZE_BYTES = 1 * 1024 * 1024; // 1 MB

// Use the lower of the two limits as the global maximum
const GLOBAL_MAX_IMAGE_SIZE_BYTES = Math.min(
    X_MAX_IMAGE_SIZE_BYTES,
    BSKY_MAX_IMAGE_SIZE_BYTES
);

// --- Functions ---

/**
 * Finds the 'latest' image in the src folder, checks its size, and returns its details.
 * @returns {Promise<{ filePath: string, mimeType: string, buffer: Buffer } | null>} Image details or null if not found/invalid.
 */
async function findAndValidateImage() {
    const commonExtensions = ['.png', '.jpg', '.jpeg', '.gif'];
    let imageFilePath = null;
    let imageBuffer = null;
    let imageMimeType = null;

    for (const ext of commonExtensions) {
        const potentialPath = path.join(IMAGE_FOLDER, IMAGE_BASENAME + ext);
        if (fs.existsSync(potentialPath)) {
            try {
                const stats = fs.statSync(potentialPath);
                if (!stats.isFile()) {
                    continue; // Not a file
                }

                if (stats.size > GLOBAL_MAX_IMAGE_SIZE_BYTES) {
                    console.error(`Error: Image file '${potentialPath}' (Size: ${
                        (stats.size / (1024 * 1024)).toFixed(2)
                    } MB) exceeds the maximum allowed size of ${
                        (GLOBAL_MAX_IMAGE_SIZE_BYTES / (1024 * 1024)).toFixed(2)
                    } MB.`);
                    process.exit(1); // Exit if image is too large
                }

                imageFilePath = potentialPath;
                imageBuffer = fs.readFileSync(potentialPath);

                // Basic MIME type detection based on extension
                if (ext === '.png') imageMimeType = 'image/png';
                else if (ext === '.jpg' || ext === '.jpeg')
                    imageMimeType = 'image/jpeg';
                else if (ext === '.gif') imageMimeType = 'image/gif';
                // Add more as needed

                console.log(
                    `Found image: ${imageFilePath} (Size: ${
                        (stats.size / 1024).toFixed(2)
                    } KB, Type: ${imageMimeType})`
                );
                break; // Found the image, no need to check other extensions
            } catch (err) {
                console.warn(
                    `Could not read image file ${potentialPath}: ${err.message}`
                );
                continue;
            }
        }
    }

    if (!imageFilePath) {
        console.log(
            `No image named '${IMAGE_BASENAME}' found in '${IMAGE_FOLDER}' with extensions ${commonExtensions.join(
                ', '
            )}. Posting text only.`
        );
        return null;
    }

    if (!imageMimeType) {
        console.warn(
            `Warning: Could not determine MIME type for ${imageFilePath}. Skipping image upload.`
        );
        return null;
    }

    return { filePath: imageFilePath, mimeType: imageMimeType, buffer: imageBuffer };
}

/**
 * Posts text and optional media to X (Twitter).
 * @param {string} text The text content of the post.
 * @param {{ buffer: Buffer, mimeType: string } | null} media Optional media buffer and MIME type.
 */
async function postToX(text, media = null) {
    console.log('\n--- Posting to X (Twitter) ---');
    if ([X_APP_KEY, X_APP_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET].some(key => key.includes('YOUR_'))) {
        console.warn('X API keys are not set. Skipping X post.');
        return;
    }

    try {
        const client = new TwitterApi({
            appKey: X_APP_KEY,
            appSecret: X_APP_SECRET,
            accessToken: X_ACCESS_TOKEN,
            accessSecret: X_ACCESS_SECRET,
        });

        let mediaIds = [];
        if (media) {
            console.log('Uploading media to X...');
            const uploadedMedia = await client.v1.uploadMedia(media.buffer, {
                mimeType: media.mimeType,
                mediaCategory: 'tweet_image', // For general images
            });
            mediaIds.push(uploadedMedia);
            console.log(`Media uploaded to X with ID: ${uploadedMedia}`);
        }

        console.log('Posting tweet to X...');
        const { data: createdTweet } = await client.v2.tweet(text, {
            media: { media_ids: mediaIds },
        });

        console.log('Successfully posted to X!');
        console.log(`Tweet ID: ${createdTweet.id}`);
        console.log(`Tweet URL: https://twitter.com/i/status/${createdTweet.id}`);
    } catch (error) {
        console.error('Error posting to X:', error.message);
        if (error.data) {
            console.error('X API Error Details:', JSON.stringify(error.data, null, 2));
        }
    }
}

/**
 * Posts text and optional media to Bluesky.
 * @param {string} text The text content of the post.
 * @param {{ buffer: Buffer, mimeType: string } | null} media Optional media buffer and MIME type.
 */
async function postToBluesky(text, media = null) {
    console.log('\n--- Posting to Bluesky ---');
    if (BSKY_IDENTIFIER.includes('YOUR_') || BSKY_PASSWORD.includes('YOUR_')) {
        console.warn('Bluesky credentials are not set. Skipping Bluesky post.');
        return;
    }

    try {
        const agent = new BskyAgent({ service: 'https://bsky.social' });

        console.log('Logging into Bluesky...');
        await agent.login({
            identifier: BSKY_IDENTIFIER,
            password: BSKY_PASSWORD,
        });
        console.log('Logged into Bluesky.');

        let embeds = [];
        if (media) {
            console.log('Uploading media to Bluesky...');
            const uploadRes = await agent.uploadBlob(media.buffer, {
                encoding: media.mimeType,
            });
            if (uploadRes.data && uploadRes.data.blob) {
                embeds.push({
                    $type: 'app.bsky.embed.images',
                    images: [
                        {
                            alt: 'Image posted via API', // Provide a meaningful alt text
                            image: uploadRes.data.blob,
                        },
                    ],
                });
                console.log('Media uploaded to Bluesky.');
            } else {
                console.warn('Bluesky media upload failed or returned unexpected data.');
            }
        }

        const rt = new RichText({ text: text });
        await rt.detectFacets(agent); // Detect mentions, links, etc.

        console.log('Creating Bluesky post...');
        const postRes = await agent.post({
            text: rt.text,
            facets: rt.facets,
            embed: embeds.length > 0 ? embeds[0] : undefined, // Only add embed if media exists
        });

        console.log('Successfully posted to Bluesky!');
        console.log(`Post URI: ${postRes.uri}`);
        console.log(`Post URL (approx): https://bsky.app/profile/${BSKY_IDENTIFIER}/post/${postRes.uri.split('/').pop()}`);
    } catch (error) {
        console.error('Error posting to Bluesky:', error.message);
        if (error.response) {
            console.error(
                'Bluesky API Error Details:',
                JSON.stringify(error.response.data, null, 2)
            );
        }
    }
}

/**
 * Main function to orchestrate posting, taking postText as an argument.
 * @param {string} postText The text content to be posted.
 */
async function main(postText) {
    if (!postText) {
        console.error('Error: No post text provided. Usage: node postScript.js "Your post text here"');
        process.exit(1);
    }

    const mediaDetails = await findAndValidateImage();

    // Post to X
    await postToX(postText, mediaDetails);

    // Post to Bluesky
    await postToBluesky(postText, mediaDetails);

    console.log('\n--- Posting process completed ---');
}

// --- Script Execution ---
// Get the post text from command-line arguments
// process.argv[0] is 'node'
// process.argv[1] is 'postScript.js'
// process.argv[2] onwards are the arguments you pass
const textFromArgs = process.argv.slice(2).join(' ');

// Execute the main function with the text from arguments
main(textFromArgs).catch(console.error);