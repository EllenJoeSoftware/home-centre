package com.ellenjoe.homecentre.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class MediaKind {
    @SerialName("video") VIDEO,
    @SerialName("audio") AUDIO,
    @SerialName("image") IMAGE;

    /** Value used in query strings (`?kind=video`). */
    val apiValue: String get() = name.lowercase()
}

@Serializable
data class SeriesInfo(
    val name: String,
    val season: Int,
    val episode: Int,
)

@Serializable
data class Subtitle(
    val id: String,
    val language: String? = null,
    val label: String,
    val format: String,
)

@Serializable
data class Progress(
    val positionSec: Double,
    val completed: Boolean,
    val updatedAt: String,
)

@Serializable
data class MediaItem(
    val id: String,
    val kind: MediaKind,
    val title: String,
    val fileName: String,
    val relativePath: String,
    val libraryId: String,
    val folder: String,
    val size: Long,
    val mimeType: String,
    val durationSec: Double? = null,
    val width: Int? = null,
    val height: Int? = null,
    val videoCodec: String? = null,
    val audioCodec: String? = null,
    val container: String? = null,
    val directPlayable: Boolean,
    val series: SeriesInfo? = null,
    val artist: String? = null,
    val album: String? = null,
    val year: Int? = null,
    val addedAt: String,
    val modifiedAt: String,
    val hasThumbnail: Boolean,
    val subtitles: List<Subtitle> = emptyList(),
    val progress: Progress? = null,
) {
    /** File extension in lower case, without the dot. */
    val extension: String get() = fileName.substringAfterLast('.', "").lowercase()

    /** Fraction watched in [0,1] or null if unknown. */
    val progressFraction: Float?
        get() {
            val p = progress ?: return null
            val d = durationSec ?: return null
            if (d <= 0) return null
            return (p.positionSec / d).toFloat().coerceIn(0f, 1f)
        }

    /** Position to resume from, or null when there is nothing to resume. */
    val resumePositionSec: Double?
        get() = progress?.takeIf { !it.completed && it.positionSec > 5 }?.positionSec
}

@Serializable
data class Library(
    val id: String,
    val name: String,
    val path: String,
    val itemCount: Int,
)

@Serializable
data class Page<T>(
    val items: List<T>,
    val total: Int,
    val offset: Int,
    val limit: Int,
)

@Serializable
data class User(
    val id: Int,
    val username: String,
    val isAdmin: Boolean,
)

@Serializable
data class LoginRequest(val username: String, val password: String)

@Serializable
data class LoginResponse(val token: String, val user: User)

@Serializable
data class ServerInfo(val name: String, val version: String)

@Serializable
data class FolderEntry(val name: String, val path: String)

@Serializable
data class FolderListing(
    val path: String,
    val folders: List<FolderEntry>,
    val items: List<MediaItem>,
)

@Serializable
data class SeriesSummary(
    val name: String,
    val episodeCount: Int,
    val seasons: List<Int>,
    val thumbnailItemId: String? = null,
)

@Serializable
data class ProgressUpdate(
    val positionSec: Double,
    val completed: Boolean? = null,
)

@Serializable
data class ScanStatus(
    val running: Boolean,
    val lastScanAt: String? = null,
    val itemCount: Int,
)

@Serializable
data class ApiError(val error: String)
