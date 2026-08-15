# Codebuff Production Verification

On 2026-08-15, Nova production deployment `dpl_4kzQHWRoijWqcXuDA9t4xGC2KxE3` (commit `7732d32`) was checked with an authenticated disposable test workspace after repairing the Codebuff SDK serverless packaging.

The protected Workspace route rendered successfully. The Codebuff planner switch was present and defaulted off. Its visible copy stated that no content is sent until files are selected and the user confirms the transfer. The same screen showed the existing Daytona ready state, its network-blocked messaging, and no agent activity. No Codebuff API key was entered, displayed, or requested during this verification.

The authenticated production Settings route was then checked. It rendered the **Codebuff planner** card with the `codebuff-api-key` control typed as `password`, the “Save private key” action, selected-context consent language, and the stated no-filesystem/no-shell/no-Daytona/no-credential-access boundary. The test account did not have a configured key, and no credential value was disclosed.

For UI-state verification only, a clearly non-secret test string was saved through that password-only field. Nova returned a safe “Planner ready” state and replaced the field with a blank replacement placeholder; it did not reveal the stored value. The browser session reset while opening a disposable workspace-file dialog, and no Codebuff planning request was submitted.

A subsequent restored session again rendered the authenticated Workspace and the default-off planner. Two browser automation attempts to open the disposable new-file dialog timed out before the dialog state could be inspected. No Codebuff request or external task was invoked during either attempt.

The temporary planner configuration was then removed through the authenticated Settings UI. Nova confirmed the removal, returned the Codebuff field to its empty password-only state, and did not disclose the stored test value at any point.

The test-only configuration was briefly restored to validate the deployed opt-in flow. In the authenticated Workspace, the Codebuff planner remained defaulted off. Enabling its switch revealed a planning prompt, a `Choose files (0)` selector, and an unchecked acknowledgement stating that selected file contents would be sent to Codebuff’s hosted service. The “Create Codebuff plan” action remained unavailable because no files were selected and consent was not provided. No Codebuff request was submitted.

After that check, the removal control was invoked again in Settings for the restored non-secret test configuration. Its completed state is confirmed in the subsequent production cleanup check.

The final cleanup check confirmed the test configuration was removed: the Codebuff password control returned to the empty “Paste a Codebuff API key” state and the remove action was absent. No planner request was made and no test key remains on the disposable verification workspace.
