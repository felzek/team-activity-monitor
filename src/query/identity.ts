import type { IdentityResolution, TeamMember } from "../types/activity.js";

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreMemberMatch(searchText: string, member: TeamMember): number {
  const normalizedSearchText = normalizeName(searchText);
  const matchables = [
    member.displayName,
    ...member.aliases
  ].map((value) => normalizeName(value));

  let bestScore = 0;

  for (const alias of matchables) {
    if (normalizedSearchText === alias) {
      bestScore = Math.max(bestScore, 100);
    } else if (` ${normalizedSearchText} `.includes(` ${alias} `)) {
      bestScore = Math.max(bestScore, 80 + alias.length);
    } else if (` ${alias} `.includes(` ${normalizedSearchText} `)) {
      bestScore = Math.max(bestScore, 70 + normalizedSearchText.length);
    } else if (alias.includes(normalizedSearchText) || normalizedSearchText.includes(alias)) {
      bestScore = Math.max(bestScore, 50);
    }
  }

  return bestScore;
}

export function resolveIdentity(
  memberText: string | null,
  rawQuery: string,
  teamMembers: TeamMember[]
): IdentityResolution {
  const searchBasis = memberText ?? rawQuery;
  const scored = teamMembers
    .map((member) => ({
      member,
      score: scoreMemberMatch(searchBasis, member)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) {
    return {
      member: null,
      needsClarification: true,
      clarificationReason: "I couldn't match that name to a configured team member.",
      candidates: []
    };
  }

  const topScore = scored[0].score;
  const topMatches = scored.filter((entry) => entry.score === topScore);

  if (topMatches.length > 1) {
    return {
      member: null,
      needsClarification: true,
      clarificationReason: `I found multiple possible matches: ${topMatches
        .map((entry) => entry.member.displayName)
        .join(", ")}.`,
      candidates: topMatches.map((entry) => entry.member)
    };
  }

  return {
    member: scored[0].member,
    needsClarification: false,
    clarificationReason: null,
    candidates: [scored[0].member]
  };
}
