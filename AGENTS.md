# Materia release preference

- After a Materia change is implemented and verified, complete both release paths: publish the validated web version and create and upload a new iOS build to TestFlight.
- Increment the iOS build number, rebuild the native web bundle, sync Capacitor, archive the Release build, and verify that App Store Connect accepted the upload.
- Do not describe a release as complete until the requested web deployment and TestFlight upload have both reached a confirmed successful state; report either failure explicitly.
