package com.ellenjoe.homecentre.core.api

import com.ellenjoe.homecentre.core.model.FolderListing
import com.ellenjoe.homecentre.core.model.Library
import com.ellenjoe.homecentre.core.model.LoginRequest
import com.ellenjoe.homecentre.core.model.LoginResponse
import com.ellenjoe.homecentre.core.model.MediaItem
import com.ellenjoe.homecentre.core.model.Page
import com.ellenjoe.homecentre.core.model.Progress
import com.ellenjoe.homecentre.core.model.ProgressUpdate
import com.ellenjoe.homecentre.core.model.ScanStatus
import com.ellenjoe.homecentre.core.model.SeriesSummary
import com.ellenjoe.homecentre.core.model.ServerInfo
import com.ellenjoe.homecentre.core.model.User
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

/** Retrofit mirror of docs/API.md. Base URL is `<server>/` — paths include `api/`. */
interface HomeCentreApi {
    @GET("api/server/info")
    suspend fun serverInfo(): ServerInfo

    @POST("api/auth/login")
    suspend fun login(@Body body: LoginRequest): LoginResponse

    @GET("api/me")
    suspend fun me(): User

    @GET("api/libraries")
    suspend fun libraries(): List<Library>

    @GET("api/scan/status")
    suspend fun scanStatus(): ScanStatus

    @GET("api/media")
    suspend fun media(
        @Query("kind") kind: String? = null,
        @Query("libraryId") libraryId: String? = null,
        @Query("folder") folder: String? = null,
        @Query("q") q: String? = null,
        @Query("sort") sort: String? = null,
        @Query("order") order: String? = null,
        @Query("offset") offset: Int? = null,
        @Query("limit") limit: Int? = null,
    ): Page<MediaItem>

    @GET("api/media/recent")
    suspend fun recent(@Query("limit") limit: Int = 20): List<MediaItem>

    @GET("api/media/continue")
    suspend fun continueWatching(): List<MediaItem>

    @GET("api/media/{id}")
    suspend fun item(@Path("id") id: String): MediaItem

    @GET("api/folders")
    suspend fun folders(
        @Query("libraryId") libraryId: String,
        @Query("path") path: String = "",
    ): FolderListing

    @GET("api/series")
    suspend fun series(): List<SeriesSummary>

    @GET("api/series/{name}/episodes")
    suspend fun episodes(@Path("name") name: String): List<MediaItem>

    @PUT("api/media/{id}/progress")
    suspend fun putProgress(@Path("id") id: String, @Body body: ProgressUpdate): Progress
}
