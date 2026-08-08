import type { ChipId, InputProblem } from "lib/types/InputProblem"
import type { Placement } from "lib/types/OutputLayout"
import { getRotatedSize } from "lib/utils/rotatePinOffset"
import { placementsOverlap } from "./placementsOverlap"

type Axis = "x" | "y"
type PackingDirection = -1 | 1

type TestPointPlacementContext = {
  inputProblem: InputProblem
  chipPlacements: Record<ChipId, Placement>
}

type LooseTestPointRowCandidate = {
  chipPlacements: Record<ChipId, Placement>
  collisionCount: number
  totalDisplacement: number
}

const MINIMUM_COLLISION_SEARCH_STEP = 0.2
const COLLISION_SEARCH_BOUNDARY_PADDING_STEPS = 2

const getTestPointPlacementSpan = (
  {
    testPointChipIds,
    axis,
  }: {
    testPointChipIds: ChipId[]
    axis: Axis
  },
  context: TestPointPlacementContext,
): number => {
  const positions = testPointChipIds.map(
    (chipId) => context.chipPlacements[chipId]![axis],
  )
  return Math.max(...positions) - Math.min(...positions)
}

const getLooseTestPointRowAxes = (
  { looseTestPointChipIds }: { looseTestPointChipIds: ChipId[] },
  context: TestPointPlacementContext,
): { perpendicularAxis: Axis; tangentAxis: Axis } => {
  const horizontalSpan = getTestPointPlacementSpan(
    { testPointChipIds: looseTestPointChipIds, axis: "x" },
    context,
  )
  const verticalSpan = getTestPointPlacementSpan(
    { testPointChipIds: looseTestPointChipIds, axis: "y" },
    context,
  )
  if (horizontalSpan >= verticalSpan) {
    return { perpendicularAxis: "y", tangentAxis: "x" }
  }
  return { perpendicularAxis: "x", tangentAxis: "y" }
}

const getLooseTestPointRowCandidate = (
  {
    looseTestPointChipIds,
    perpendicularAxis,
    tangentAxis,
    packingDirection,
  }: {
    looseTestPointChipIds: ChipId[]
    perpendicularAxis: Axis
    tangentAxis: Axis
    packingDirection: PackingDirection
  },
  context: TestPointPlacementContext,
): LooseTestPointRowCandidate => {
  const perpendicularCenter =
    looseTestPointChipIds.reduce(
      (sum, chipId) => sum + context.chipPlacements[chipId]![perpendicularAxis],
      0,
    ) / looseTestPointChipIds.length
  const orderedTestPointChipIds = [...looseTestPointChipIds].sort(
    (chipIdA, chipIdB) =>
      (context.chipPlacements[chipIdA]![tangentAxis] -
        context.chipPlacements[chipIdB]![tangentAxis]) *
      packingDirection,
  )
  const chipPlacements: Record<ChipId, Placement> = {}
  let previousTestPointChipId: ChipId | undefined

  for (const chipId of orderedTestPointChipIds) {
    const originalPlacement = context.chipPlacements[chipId]!
    const placement = {
      ...originalPlacement,
      [perpendicularAxis]: perpendicularCenter,
    }
    if (previousTestPointChipId) {
      const previousPlacement = chipPlacements[previousTestPointChipId]!
      const previousSize = getRotatedSize(
        context.inputProblem.chipMap[previousTestPointChipId]!.size,
        previousPlacement.ccwRotationDegrees,
      )
      const currentSize = getRotatedSize(
        context.inputProblem.chipMap[chipId]!.size,
        placement.ccwRotationDegrees,
      )
      const minimumCenterDistance =
        previousSize[tangentAxis] / 2 +
        context.inputProblem.chipGap +
        currentSize[tangentAxis] / 2
      const packedTangentPosition =
        previousPlacement[tangentAxis] +
        packingDirection * minimumCenterDistance
      if (
        packingDirection * placement[tangentAxis] <
        packingDirection * packedTangentPosition
      ) {
        placement[tangentAxis] = packedTangentPosition
      }
    }
    chipPlacements[chipId] = placement
    previousTestPointChipId = chipId
  }

  return getLooseTestPointRowCandidateScore(
    { looseTestPointChipIds, chipPlacements },
    context,
  )
}

const getLooseTestPointRowCandidateScore = (
  {
    looseTestPointChipIds,
    chipPlacements,
  }: {
    looseTestPointChipIds: ChipId[]
    chipPlacements: Record<ChipId, Placement>
  },
  context: TestPointPlacementContext,
): LooseTestPointRowCandidate => {
  const looseTestPointChipIdSet = new Set(looseTestPointChipIds)
  let collisionCount = 0
  let totalDisplacement = 0
  for (const chipId of looseTestPointChipIds) {
    const placement = chipPlacements[chipId]!
    const originalPlacement = context.chipPlacements[chipId]!
    totalDisplacement +=
      Math.abs(placement.x - originalPlacement.x) +
      Math.abs(placement.y - originalPlacement.y)
    for (const [otherChipId, otherPlacement] of Object.entries(
      context.chipPlacements,
    )) {
      if (looseTestPointChipIdSet.has(otherChipId)) continue
      if (
        placementsOverlap({
          inputProblem: context.inputProblem,
          chipIdA: chipId,
          placementA: placement,
          chipIdB: otherChipId,
          placementB: otherPlacement,
        })
      ) {
        collisionCount++
      }
    }
  }

  return { chipPlacements, collisionCount, totalDisplacement }
}

const moveLooseTestPointRowUntilClear = (
  {
    looseTestPointChipIds,
    perpendicularAxis,
    candidate,
  }: {
    looseTestPointChipIds: ChipId[]
    perpendicularAxis: Axis
    candidate: LooseTestPointRowCandidate
  },
  context: TestPointPlacementContext,
): LooseTestPointRowCandidate => {
  if (candidate.collisionCount === 0) return candidate

  const looseTestPointChipIdSet = new Set(looseTestPointChipIds)
  const searchStep = Math.max(
    context.inputProblem.chipGap,
    MINIMUM_COLLISION_SEARCH_STEP,
  )
  const rowCenter =
    looseTestPointChipIds.reduce(
      (sum, chipId) =>
        sum + candidate.chipPlacements[chipId]![perpendicularAxis],
      0,
    ) / looseTestPointChipIds.length
  const maximumTestPointExtent = Math.max(
    ...looseTestPointChipIds.map((chipId) => {
      const placement = candidate.chipPlacements[chipId]!
      return getRotatedSize(
        context.inputProblem.chipMap[chipId]!.size,
        placement.ccwRotationDegrees,
      )[perpendicularAxis]
    }),
  )
  const maximumSearchDistance = Object.entries(context.chipPlacements).reduce(
    (maximumDistance, [chipId, placement]) => {
      if (looseTestPointChipIdSet.has(chipId)) return maximumDistance
      const chipExtent = getRotatedSize(
        context.inputProblem.chipMap[chipId]!.size,
        placement.ccwRotationDegrees,
      )[perpendicularAxis]
      return Math.max(
        maximumDistance,
        Math.abs(placement[perpendicularAxis] - rowCenter) +
          chipExtent +
          maximumTestPointExtent +
          context.inputProblem.chipGap,
      )
    },
    0,
  )
  const maximumSearchSteps =
    Math.ceil(maximumSearchDistance / searchStep) +
    COLLISION_SEARCH_BOUNDARY_PADDING_STEPS
  let bestCandidate = candidate

  for (let stepIndex = 1; stepIndex <= maximumSearchSteps; stepIndex++) {
    const offsets = [-stepIndex * searchStep, stepIndex * searchStep]
    for (const offset of offsets) {
      const chipPlacements = Object.fromEntries(
        looseTestPointChipIds.map((chipId) => {
          const placement = candidate.chipPlacements[chipId]!
          return [
            chipId,
            {
              ...placement,
              [perpendicularAxis]: placement[perpendicularAxis] + offset,
            },
          ]
        }),
      )
      const shiftedCandidate = getLooseTestPointRowCandidateScore(
        { looseTestPointChipIds, chipPlacements },
        context,
      )
      if (shiftedCandidate.collisionCount < bestCandidate.collisionCount) {
        bestCandidate = shiftedCandidate
      } else if (
        shiftedCandidate.collisionCount === bestCandidate.collisionCount &&
        shiftedCandidate.totalDisplacement < bestCandidate.totalDisplacement
      ) {
        bestCandidate = shiftedCandidate
      }
    }
    if (bestCandidate.collisionCount === 0) break
  }

  return bestCandidate
}

export const alignLooseTestPoints = (
  { anchoredTestPointChipIds }: { anchoredTestPointChipIds: Set<ChipId> },
  context: TestPointPlacementContext,
): void => {
  const looseTestPointChipIds = Object.values(context.inputProblem.chipMap)
    .filter(
      (chip) =>
        chip.isTestPoint &&
        !chip.fixedPosition &&
        chip.pins.length === 1 &&
        context.chipPlacements[chip.chipId] &&
        !anchoredTestPointChipIds.has(chip.chipId),
    )
    .map((chip) => chip.chipId)
  if (looseTestPointChipIds.length < 2) return

  const { perpendicularAxis, tangentAxis } = getLooseTestPointRowAxes(
    { looseTestPointChipIds },
    context,
  )
  const negativeCandidate = moveLooseTestPointRowUntilClear(
    {
      looseTestPointChipIds,
      perpendicularAxis,
      candidate: getLooseTestPointRowCandidate(
        {
          looseTestPointChipIds,
          perpendicularAxis,
          tangentAxis,
          packingDirection: -1,
        },
        context,
      ),
    },
    context,
  )
  const positiveCandidate = moveLooseTestPointRowUntilClear(
    {
      looseTestPointChipIds,
      perpendicularAxis,
      candidate: getLooseTestPointRowCandidate(
        {
          looseTestPointChipIds,
          perpendicularAxis,
          tangentAxis,
          packingDirection: 1,
        },
        context,
      ),
    },
    context,
  )
  let bestCandidate = negativeCandidate
  if (positiveCandidate.collisionCount < negativeCandidate.collisionCount) {
    bestCandidate = positiveCandidate
  } else if (
    positiveCandidate.collisionCount === negativeCandidate.collisionCount &&
    positiveCandidate.totalDisplacement < negativeCandidate.totalDisplacement
  ) {
    bestCandidate = positiveCandidate
  }

  for (const [chipId, placement] of Object.entries(
    bestCandidate.chipPlacements,
  )) {
    context.chipPlacements[chipId] = placement
  }
}
