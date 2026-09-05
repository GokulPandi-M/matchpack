import { boundsAreaOverlap } from "@tscircuit/math-utils"
import type { ChipId, InputProblem, NetId } from "../../types/InputProblem"
import type { Placement } from "../../types/OutputLayout"
import { rotatePinOffset } from "../../utils/rotatePinOffset"
import { getPlacementBounds } from "../AlignTestPointsSolver/placementsOverlap"
import type { GroundedLoadPair } from "./getGroundedLoadPairs"

type GroundedLoadPairBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

type GroundedLoadRowContext = {
  chipPlacements: Record<ChipId, Placement>
  inputProblem: InputProblem
}

const MINIMUM_PAIRS_PER_ROW = 2

const getPairBounds = (
  groundedLoadPair: GroundedLoadPair,
  context: GroundedLoadRowContext,
): GroundedLoadPairBounds => {
  const { chipPlacements } = context
  const upperPlacement = chipPlacements[groundedLoadPair.upperChip.chipId]!
  const lowerPlacement = chipPlacements[groundedLoadPair.lowerChip.chipId]!
  const upperBounds = getPlacementBounds({
    placement: upperPlacement,
    size: groundedLoadPair.upperChip.size,
  })
  const lowerBounds = getPlacementBounds({
    placement: lowerPlacement,
    size: groundedLoadPair.lowerChip.size,
  })

  return {
    minX: Math.min(upperBounds.minX, lowerBounds.minX),
    maxX: Math.max(upperBounds.maxX, lowerBounds.maxX),
    minY: Math.min(upperBounds.minY, lowerBounds.minY),
    maxY: Math.max(upperBounds.maxY, lowerBounds.maxY),
  }
}

const getGroundPinY = (
  groundedLoadPair: GroundedLoadPair,
  context: GroundedLoadRowContext,
): number => {
  const { chipPlacements, inputProblem } = context
  const placement = chipPlacements[groundedLoadPair.lowerChip.chipId]!
  const groundPin = inputProblem.chipPinMap[groundedLoadPair.groundPinId]!
  const groundPinOffset = rotatePinOffset(
    groundPin.offset,
    placement.ccwRotationDegrees,
  )
  return placement.y + groundPinOffset.y
}

const translateGroundedLoadPair = (
  {
    groundedLoadPair,
    dx,
    dy,
  }: {
    groundedLoadPair: GroundedLoadPair
    dx: number
    dy: number
  },
  context: GroundedLoadRowContext,
): void => {
  const { chipPlacements } = context
  for (const chipId of [
    groundedLoadPair.upperChip.chipId,
    groundedLoadPair.lowerChip.chipId,
  ]) {
    const placement = chipPlacements[chipId]!
    placement.x += dx
    placement.y += dy
  }
}

const getLeftPairEdge = (
  groundedLoadPair: GroundedLoadPair,
  context: GroundedLoadRowContext,
): number => {
  return getPairBounds(groundedLoadPair, context).minX
}

const getRowBounds = (
  groundedLoadPairs: GroundedLoadPair[],
  context: GroundedLoadRowContext,
): GroundedLoadPairBounds => {
  const pairBounds = groundedLoadPairs.map((groundedLoadPair) =>
    getPairBounds(groundedLoadPair, context),
  )
  return {
    minX: Math.min(...pairBounds.map((bounds) => bounds.minX)),
    maxX: Math.max(...pairBounds.map((bounds) => bounds.maxX)),
    minY: Math.min(...pairBounds.map((bounds) => bounds.minY)),
    maxY: Math.max(...pairBounds.map((bounds) => bounds.maxY)),
  }
}

const rowHasOverlappingPairs = (
  groundedLoadPairs: GroundedLoadPair[],
  context: GroundedLoadRowContext,
): boolean => {
  const pairBounds = groundedLoadPairs.map((groundedLoadPair) =>
    getPairBounds(groundedLoadPair, context),
  )
  for (let firstIndex = 0; firstIndex < pairBounds.length; firstIndex++) {
    for (const secondBounds of pairBounds.slice(firstIndex + 1)) {
      if (boundsAreaOverlap(pairBounds[firstIndex]!, secondBounds) > 0) {
        return true
      }
    }
  }

  return false
}

const alignGroundedLoadPairRow = (
  groundedLoadPairs: GroundedLoadPair[],
  context: GroundedLoadRowContext,
  preserveInitialHorizontalCenter = false,
): void => {
  const { inputProblem } = context
  const leftToRightPairs = [...groundedLoadPairs].sort(
    (pairA, pairB) =>
      getLeftPairEdge(pairA, context) - getLeftPairEdge(pairB, context),
  )
  const initialGroundPinYs = leftToRightPairs.map((groundedLoadPair) =>
    getGroundPinY(groundedLoadPair, context),
  )
  const initialRowBounds = getRowBounds(leftToRightPairs, context)

  const targetGroundPinY = Math.min(...initialGroundPinYs)
  for (const groundedLoadPair of leftToRightPairs) {
    const groundPinY = getGroundPinY(groundedLoadPair, context)
    translateGroundedLoadPair(
      {
        groundedLoadPair,
        dx: 0,
        dy: targetGroundPinY - groundPinY,
      },
      context,
    )
  }

  let previousPairMaxX: number | undefined
  for (const groundedLoadPair of leftToRightPairs) {
    const pairBounds = getPairBounds(groundedLoadPair, context)
    if (previousPairMaxX === undefined) {
      previousPairMaxX = pairBounds.maxX
      continue
    }
    const dx = previousPairMaxX + inputProblem.partitionGap - pairBounds.minX
    translateGroundedLoadPair(
      {
        groundedLoadPair,
        dx,
        dy: 0,
      },
      context,
    )
    previousPairMaxX = pairBounds.maxX + dx
  }

  if (preserveInitialHorizontalCenter) {
    const alignedRowBounds = getRowBounds(leftToRightPairs, context)
    const dx =
      (initialRowBounds.minX +
        initialRowBounds.maxX -
        alignedRowBounds.minX -
        alignedRowBounds.maxX) /
      2
    for (const groundedLoadPair of leftToRightPairs) {
      translateGroundedLoadPair({ groundedLoadPair, dx, dy: 0 }, context)
    }
  }
}

export const alignGroundedLoadPairRows = ({
  groundedLoadPairs,
  chipPlacements,
  inputProblem,
}: {
  groundedLoadPairs: GroundedLoadPair[]
  chipPlacements: Record<ChipId, Placement>
  inputProblem: InputProblem
}): void => {
  const context = { chipPlacements, inputProblem }
  const pairsByGroundAndMainChip = new Map<
    NetId,
    Map<ChipId | undefined, GroundedLoadPair[]>
  >()
  for (const groundedLoadPair of groundedLoadPairs) {
    if (!chipPlacements[groundedLoadPair.upperChip.chipId]) continue
    if (!chipPlacements[groundedLoadPair.lowerChip.chipId]) continue
    if (!inputProblem.chipPinMap[groundedLoadPair.groundPinId]) continue
    const pairsByMainChip =
      pairsByGroundAndMainChip.get(groundedLoadPair.groundNetId) ??
      new Map<ChipId | undefined, GroundedLoadPair[]>()
    const rowPairs = pairsByMainChip.get(groundedLoadPair.mainChipId) ?? []
    rowPairs.push(groundedLoadPair)
    pairsByMainChip.set(groundedLoadPair.mainChipId, rowPairs)
    pairsByGroundAndMainChip.set(groundedLoadPair.groundNetId, pairsByMainChip)
  }

  for (const pairsByMainChip of pairsByGroundAndMainChip.values()) {
    for (const rowPairs of pairsByMainChip.values()) {
      if (rowPairs.length < MINIMUM_PAIRS_PER_ROW) continue
      const isChipAnchoredRow = rowPairs[0]!.mainChipId !== undefined
      if (isChipAnchoredRow && !rowHasOverlappingPairs(rowPairs, context)) {
        continue
      }
      alignGroundedLoadPairRow(rowPairs, context, isChipAnchoredRow)
    }
  }
}
