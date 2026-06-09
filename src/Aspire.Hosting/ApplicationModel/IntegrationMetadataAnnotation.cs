// Licensed to the .NET Foundation under one or more agreements.
// The .NET Foundation licenses this file to you under the MIT license.

namespace Aspire.Hosting.ApplicationModel;

/// <summary>
/// Stores integration-authored metadata on a resource so it can be read by later callbacks.
/// </summary>
/// <param name="name">The integration-scoped metadata name.</param>
/// <param name="value">The serialized metadata value.</param>
internal sealed class IntegrationMetadataAnnotation(string name, string value) : IResourceAnnotation
{
    /// <summary>
    /// Gets the integration-scoped metadata name.
    /// </summary>
    public string Name { get; } = name;

    /// <summary>
    /// Gets the serialized metadata value.
    /// </summary>
    public string Value { get; } = value;
}
