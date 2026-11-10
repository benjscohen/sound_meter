// sm-helper: the small native companion to Sound Meter.
//
// Electron can't reach EventKit or CoreAudio's process list, so the app runs
// this binary and reads one JSON object from stdout. It never touches audio
// content and never writes anything.
//
//   sm-helper mic-apps                       which apps are using a microphone
//   sm-helper calendar-status                current Calendar permission
//   sm-helper calendar-request               ask for Calendar permission
//   sm-helper calendar-events <fromMs> <toMs>  events overlapping a time range
//
// Build with: npm run build:helper

import AppKit
import CoreAudio
import EventKit
import Foundation

func emit(_ object: [String: Any]) -> Never {
    let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(0)
}

// MARK: - Microphone use

@available(macOS 14.2, *)
func audioProperty<T>(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector, _ initial: T) -> T? {
    var address = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var size = UInt32(MemoryLayout<T>.size)
    var value = initial
    let status = withUnsafeMutablePointer(to: &value) {
        AudioObjectGetPropertyData(object, &address, 0, nil, &size, $0)
    }
    return status == noErr ? value : nil
}

@available(macOS 14.2, *)
func audioProcessObjects() -> [AudioObjectID] {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyProcessObjectList,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    let system = AudioObjectID(kAudioObjectSystemObject)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(system, &address, 0, nil, &size) == noErr, size > 0 else { return [] }
    var objects = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(system, &address, 0, nil, &size, &objects) == noErr else { return [] }
    return objects
}

func micApps() -> Never {
    guard #available(macOS 14.2, *) else {
        emit(["supported": false, "apps": []])
    }

    var apps: [[String: Any]] = []
    var seen = Set<String>()

    for object in audioProcessObjects() {
        guard let running = audioProperty(object, kAudioProcessPropertyIsRunningInput, UInt32(0)), running != 0
        else { continue }
        guard let unmanaged = audioProperty(object, kAudioProcessPropertyBundleID, Unmanaged<CFString>?.none),
              let bundleRef = unmanaged
        else { continue }
        let bundleId = bundleRef.takeRetainedValue() as String
        guard !bundleId.isEmpty, seen.insert(bundleId).inserted else { continue }

        // Helper processes (browser renderers, audio services) belong to a
        // parent app: find it by walking up the bundle identifier.
        var name: String? = nil
        var parts = bundleId.split(separator: ".").map(String.init)
        while parts.count >= 2 && name == nil {
            let candidate = parts.joined(separator: ".")
            if let app = NSRunningApplication.runningApplications(withBundleIdentifier: candidate)
                .first(where: { $0.activationPolicy == .regular }) {
                name = app.localizedName
            }
            parts.removeLast()
        }

        var entry: [String: Any] = ["bundleId": bundleId]
        if let name = name { entry["name"] = name }
        apps.append(entry)
    }

    emit(["supported": true, "apps": apps])
}

// MARK: - Calendar

func calendarStatus() -> String {
    let status = EKEventStore.authorizationStatus(for: .event)
    if #available(macOS 14.0, *) {
        if status == .fullAccess { return "granted" }
        if status == .writeOnly { return "denied" }
    }
    switch status {
    case .notDetermined: return "not-determined"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .authorized: return "granted"
    default: return "denied"
    }
}

func calendarRequest() -> Never {
    let store = EKEventStore()
    let done = DispatchSemaphore(value: 0)
    if #available(macOS 14.0, *) {
        store.requestFullAccessToEvents { _, _ in done.signal() }
    } else {
        store.requestAccess(to: .event) { _, _ in done.signal() }
    }
    _ = done.wait(timeout: .now() + 120)
    emit(["status": calendarStatus()])
}

func calendarEvents(_ arguments: [String]) -> Never {
    guard arguments.count == 2, let fromMs = Double(arguments[0]), let toMs = Double(arguments[1]), toMs > fromMs
    else { emit(["status": calendarStatus(), "events": [], "error": "usage"]) }
    guard calendarStatus() == "granted" else { emit(["status": calendarStatus(), "events": []]) }

    let store = EKEventStore()
    let predicate = store.predicateForEvents(
        withStart: Date(timeIntervalSince1970: fromMs / 1000),
        end: Date(timeIntervalSince1970: toMs / 1000),
        calendars: nil)

    let events: [[String: Any]] = store.events(matching: predicate).compactMap { event in
        guard !event.isAllDay, let start = event.startDate, let end = event.endDate else { return nil }
        let attendees = event.attendees ?? []
        if attendees.contains(where: { $0.isCurrentUser && $0.participantStatus == .declined }) { return nil }
        if event.status == .canceled { return nil }

        let people = attendees
            .filter { !$0.isCurrentUser && $0.participantType == .person }
            .compactMap { $0.name?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        return [
            "title": (event.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
            "start": (start.timeIntervalSince1970 * 1000).rounded(),
            "end": (end.timeIntervalSince1970 * 1000).rounded(),
            "people": people
        ]
    }

    emit(["status": "granted", "events": events])
}

// MARK: - Entry point

let arguments = Array(CommandLine.arguments.dropFirst())
switch arguments.first {
case "mic-apps": micApps()
case "calendar-status": emit(["status": calendarStatus()])
case "calendar-request": calendarRequest()
case "calendar-events": calendarEvents(Array(arguments.dropFirst()))
default:
    FileHandle.standardError.write(Data("usage: sm-helper mic-apps | calendar-status | calendar-request | calendar-events <fromMs> <toMs>\n".utf8))
    exit(64)
}
