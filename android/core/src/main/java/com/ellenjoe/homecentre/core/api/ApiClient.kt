package com.ellenjoe.homecentre.core.api

import kotlinx.serialization.json.Json
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Response
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit

val HomeCentreJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
    encodeDefaults = false
}

/** Adds `Authorization: Bearer <token>` when a token is available and the request has none. */
class AuthInterceptor(private val tokenProvider: () -> String?) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val token = tokenProvider()
        if (token.isNullOrBlank() || request.header("Authorization") != null) {
            return chain.proceed(request)
        }
        return chain.proceed(
            request.newBuilder().header("Authorization", "Bearer $token").build()
        )
    }
}

object ApiClient {
    /**
     * Normalises user input like `192.168.1.10:8096` or `http://host:8096/` into a base URL
     * ending with `/`. Returns null when it cannot be parsed.
     */
    fun normalizeServerUrl(input: String): HttpUrl? {
        var s = input.trim()
        if (s.isEmpty()) return null
        if (!s.startsWith("http://", ignoreCase = true) && !s.startsWith("https://", ignoreCase = true)) {
            s = "http://$s"
        }
        val url = s.toHttpUrlOrNull() ?: return null
        // Strip a trailing "/api" if the user typed it and ensure trailing slash.
        val segments = url.pathSegments.filter { it.isNotEmpty() }.toMutableList()
        if (segments.lastOrNull() == "api") segments.removeAt(segments.lastIndex)
        val builder = url.newBuilder().encodedPath("/").query(null).fragment(null)
        segments.forEach { builder.addPathSegment(it) }
        val built = builder.build().toString()
        return (if (built.endsWith("/")) built else "$built/").toHttpUrlOrNull()
    }

    fun okHttpClient(tokenProvider: () -> String?): OkHttpClient =
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .addInterceptor(AuthInterceptor(tokenProvider))
            .build()

    fun create(baseUrl: HttpUrl, client: OkHttpClient): HomeCentreApi =
        Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(client)
            .addConverterFactory(HomeCentreJson.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(HomeCentreApi::class.java)
}
