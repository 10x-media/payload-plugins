// The package name, as a consumer writes it: in a production build a `src` import is a second
// copy of the module, whose context no provider fills.
import { WikiCustomHelp } from '@10x-media/admin-wiki/client'

/**
 * A custom admin view at `/admin/dashboard`, standing in for the screens a
 * project registers through `admin.components.views`: nothing in the config
 * describes them, so their guides hang off `customTargets` instead.
 */
export const DevDashboard = () => (
	<div className="gutter--left gutter--right" style={{ paddingBlock: 'var(--base)' }}>
		<h1>
			Dashboard <WikiCustomHelp target="dashboard" />
		</h1>
		<section id="dev-dashboard-attention">
			<h2>
				Needs attention <WikiCustomHelp target="dashboard.attention" />
			</h2>
			<p>Three posts have been in review for more than a week.</p>
		</section>
	</div>
)
