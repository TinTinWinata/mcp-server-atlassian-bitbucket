import { ControllerResponse } from '../types/common.types.js';
import { UpdatePullRequestParams } from '../services/vendor.atlassian.pullrequests.types.js';
import { UpdatePullRequestToolArgsType } from '../tools/atlassian.pullrequests.types.js';
import {
	atlassianPullRequestsService,
	Logger,
	handleControllerError,
	formatPullRequestDetails,
	applyDefaults,
	optimizeBitbucketMarkdown,
	getDefaultWorkspace,
} from './atlassian.pullrequests.base.controller.js';

/**
 * Update an existing pull request in Bitbucket
 * @param options - Options including workspace slug, repo slug, pull request ID, title, and description
 * @returns Promise with formatted updated pull request details as Markdown content
 */
async function update(
	options: UpdatePullRequestToolArgsType,
): Promise<ControllerResponse> {
	const methodLogger = Logger.forContext(
		'controllers/atlassian.pullrequests.update.controller.ts',
		'update',
	);

	try {
		// Apply defaults if needed (none for this operation)
		const mergedOptions = applyDefaults<UpdatePullRequestToolArgsType>(
			options,
			{},
		);

		// Handle optional workspaceSlug - get default if not provided
		if (!mergedOptions.workspaceSlug) {
			methodLogger.debug(
				'No workspace provided, fetching default workspace',
			);
			const defaultWorkspace = await getDefaultWorkspace();
			if (!defaultWorkspace) {
				throw new Error(
					'Could not determine a default workspace. Please provide a workspaceSlug.',
				);
			}
			mergedOptions.workspaceSlug = defaultWorkspace;
			methodLogger.debug(
				`Using default workspace: ${mergedOptions.workspaceSlug}`,
			);
		}

		// Validate that at least one field to update is provided
		const hasReviewers = mergedOptions.reviewers !== undefined;
		if (
			!mergedOptions.title &&
			!mergedOptions.description &&
			!hasReviewers
		) {
			throw new Error(
				'At least one field to update (title, description, or reviewers) must be provided',
			);
		}

		methodLogger.debug(
			`Updating pull request ${mergedOptions.pullRequestId} in ${mergedOptions.workspaceSlug}/${mergedOptions.repoSlug}`,
		);

		// Prepare service parameters
		const serviceParams: UpdatePullRequestParams = {
			workspace: mergedOptions.workspaceSlug,
			repo_slug: mergedOptions.repoSlug,
			pull_request_id: mergedOptions.pullRequestId,
		};

		// Add optional fields if provided
		if (mergedOptions.title !== undefined) {
			serviceParams.title = mergedOptions.title;
		}
		if (mergedOptions.description !== undefined) {
			serviceParams.description = optimizeBitbucketMarkdown(
				mergedOptions.description,
			);
		}
		if (hasReviewers) {
			// Map account IDs to the reviewer reference shape Bitbucket expects
			serviceParams.reviewers = (mergedOptions.reviewers ?? []).map(
				(accountId) => ({ account_id: accountId }),
			);

			// Bitbucket's PUT endpoint can reject a reviewer-only update that
			// omits the title. When the caller is only changing reviewers,
			// fetch the current title and include it to keep the PR intact.
			if (serviceParams.title === undefined) {
				methodLogger.debug(
					'Reviewers update without title; fetching current PR title',
				);
				const currentPr = await atlassianPullRequestsService.get({
					workspace: serviceParams.workspace,
					repo_slug: serviceParams.repo_slug,
					pull_request_id: serviceParams.pull_request_id,
				});
				serviceParams.title = currentPr.title;
			}
		}

		// Call service to update the pull request
		const pullRequest =
			await atlassianPullRequestsService.update(serviceParams);

		methodLogger.debug(
			`Successfully updated pull request ${pullRequest.id}`,
		);

		// Format the response
		const content = await formatPullRequestDetails(pullRequest);

		return {
			content: `## Pull Request Updated Successfully\n\n${content}`,
		};
	} catch (error) {
		throw handleControllerError(error, {
			entityType: 'Pull Request',
			operation: 'updating',
			source: 'controllers/atlassian.pullrequests.update.controller.ts@update',
			additionalInfo: { options },
		});
	}
}

export default { update };
