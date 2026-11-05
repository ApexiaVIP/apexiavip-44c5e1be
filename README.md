# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)

## Releasing the iPhone app

The Android app is this website wrapped, so it updates the moment the site
deploys and needs nothing here. iPhones get nothing until a build is uploaded.

Two things have to be in place, both already set up on the build machine:

- `~/.appstoreconnect/config.json` holding `keyId` and `issuerId`, with the
  matching `private_keys/AuthKey_<keyId>.p8`
- `~/Library/Keychains/apexia-build.keychain-db`, whose password is in
  `~/.appstoreconnect/build-keychain.pass`. The Apple Distribution
  certificate lives in there, not in the login keychain.

```sh
# 1. Move the version. Both places, together: a test fails if they differ.
#    src/lib/release.ts            VERSION and BUILD
#    ios/App/App.xcodeproj         MARKETING_VERSION and CURRENT_PROJECT_VERSION
npm run test:release

# 2. Build the web assets and put them in the iOS project
npm run ios:sync

# 3. Archive
cd ios/App
xcodebuild -project App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/App.xcarchive \
  -allowProvisioningUpdates archive

# 4. Let the shell see the distribution certificate
security unlock-keychain -p "$(cat ~/.appstoreconnect/build-keychain.pass)" \
  ~/Library/Keychains/apexia-build.keychain-db
security list-keychains -d user -s ~/Library/Keychains/apexia-build.keychain-db \
  ~/Library/Keychains/login.keychain-db

# 5. Export and upload. exportOptions.plist has destination=upload, so this
#    step is the upload: there is nothing to drag into Transporter afterwards.
KEYID=$(python3 -c "import json;print(json.load(open('$HOME/.appstoreconnect/config.json'))['keyId'])")
ISSUER=$(python3 -c "import json;print(json.load(open('$HOME/.appstoreconnect/config.json'))['issuerId'])")
xcodebuild -exportArchive -archivePath build/App.xcarchive \
  -exportOptionsPlist exportOptions.plist -exportPath build/export \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$HOME/.appstoreconnect/private_keys/AuthKey_$KEYID.p8" \
  -authenticationKeyID "$KEYID" -authenticationKeyIssuerID "$ISSUER"

# 6. Confirm Apple actually has it. Takes two or three minutes to appear.
cd ../.. && python3 scripts/asc.py builds
```

Two failures worth recognising, because neither says what is wrong:

- **`error: exportArchive Failed to Use Accounts`** means step 5 was run
  without the API key arguments. Xcode's own signed-in account is not
  reachable from a non-interactive shell. Pass the key.
- **`No signing certificate "iOS Distribution" found`**, usually with
  `Cloud signing permission error` beside it, means step 4 was skipped. The
  archive in step 3 signs with Apple Development and succeeds regardless, so
  the first sign of a locked keychain is the export failing.

`exportOptions.plist` sets `manageAppVersionAndBuildNumber`, so Apple is
allowed to renumber the build. Check what `scripts/asc.py builds` reports
against `src/lib/release.ts`: if they disagree, the number on the chauffeur's
screen is not the number Apple shipped and `release.ts` needs correcting.

A valid build still reaches nobody until a tester is on the TestFlight list
and the build is assigned to their group.

## Getting a build to everyone

Uploading is not releasing, and this is the step that gets forgotten. A build
can sit at `VALID` for days while the App Store still serves the previous
version, because the upload only puts it in TestFlight. Version 2.2 was
uploaded on 3 November and nothing had been submitted by the 5th.

`scripts/asc.py builds` says whether Apple has the build.
`scripts/asc.py versions` says what the public can actually install. Read both.
A build at `VALID` with no matching version row means nobody has it.

Three separate audiences, three separate actions:

- **Android drivers** already have it. The app is the website wrapped, so a
  Vercel deploy reaches them with no build and no review.
- **TestFlight.** Internal testers get the build within minutes and need no
  review, but each one must be a user on the App Store Connect account.
  External testers need only an email address, but the build goes through Beta
  App Review first, which is usually under a day and occasionally two.
- **The App Store.** In App Store Connect, add the iOS version, attach the
  build, write the release notes, submit. Everything else (description,
  keywords, screenshots, the reviewer's demo account and notes) is copied from
  the previous version, so only the release notes need writing. Review is
  normally 24 to 48 hours, and `releaseType: AFTER_APPROVAL` means it goes
  live by itself once approved.
