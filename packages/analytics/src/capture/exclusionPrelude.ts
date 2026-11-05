import type { CaptureSnippet } from '../tracker/config'
import { EXCLUSION_STASH_KEY, EXCLUSION_STASH_MS } from '../tracker/exclusion'
import { jsLiteral } from './jsLiteral'

/**
 * Leads a slot's snippet while the exclusion link is on: every vendor reads the address as it loads,
 * so the parameter leaves it here and its value is stashed, non-enumerable, for the tracker to check.
 */
export const exclusionPrelude = (param: string): string =>
	`(function(){try{var l=location,p=${jsLiteral(param)},v=new URLSearchParams(l.search).get(p);if(v===null)return;var w=window,s=${jsLiteral(EXCLUSION_STASH_KEY)};Object.defineProperty(w,s,{value:v,configurable:true});setTimeout(function(){try{delete w[s]}catch(e){}},${EXCLUSION_STASH_MS});var k=l.search.replace(/^\\?/,"").split("&").filter(function(s){if(s==="")return false;try{return decodeURIComponent(s.split("=")[0].replace(/\\+/g," "))!==p}catch(e){return true}});history.replaceState(history.state,"",l.pathname+(k.length?"?"+k.join("&"):"")+l.hash)}catch(e){}})();`

/** A snippet led by {@link exclusionPrelude} while the link is on; one with no script is left as it is. */
export const withExclusionPrelude = (
	snippet: CaptureSnippet,
	param: string | undefined
): CaptureSnippet =>
	param === undefined || snippet.scripts.length === 0
		? snippet
		: { scripts: [{ inline: exclusionPrelude(param) }, ...snippet.scripts] }
