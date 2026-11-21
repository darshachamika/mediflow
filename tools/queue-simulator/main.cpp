#include <algorithm>
#include <cmath>
#include <functional>
#include <iomanip>
#include <iostream>
#include <queue>
#include <random>
#include <string_view>
#include <vector>

struct Visit {
    int arrival;
    int duration;
};

std::vector<int> simulate(const std::vector<Visit>& visits, int rooms) {
    std::priority_queue<int, std::vector<int>, std::greater<int>> available;
    for (int room = 0; room < rooms; ++room) {
        available.push(0);
    }
    std::vector<int> waits;
    waits.reserve(visits.size());
    for (const auto& visit : visits) {
        const int start = std::max(visit.arrival, available.top());
        available.pop();
        waits.push_back(start - visit.arrival);
        available.push(start + visit.duration);
    }
    return waits;
}

struct Summary {
    double median;
    int p90;
};

Summary summarize(std::vector<int> waits) {
    std::sort(waits.begin(), waits.end());
    const auto size = waits.size();
    const double median = (waits[(size - 1) / 2] + waits[size / 2]) / 2.0;
    const auto rank = static_cast<std::size_t>(std::ceil(0.9 * static_cast<double>(size)));
    return {median, waits[rank - 1]};
}

std::vector<Visit> synthetic_day() {
    std::mt19937 random(2026);
    int arrival = 0;
    std::vector<Visit> visits;
    for (int index = 0; index < 160; ++index) {
        arrival += 1 + static_cast<int>(random() % 7);
        const int duration = 5 + static_cast<int>(random() % 13);
        visits.push_back({arrival, duration});
    }
    return visits;
}

int main(int argc, char** argv) {
    if (argc == 2 && std::string_view(argv[1]) == "--self-test") {
        const std::vector<Visit> fixture{{0, 5}, {1, 5}, {1, 3}, {2, 1}};
        const auto two = simulate(fixture, 2);
        const auto four = simulate(fixture, 4);
        const auto summary = summarize(two);
        if (two != std::vector<int>{0, 0, 4, 4} || four != std::vector<int>{0, 0, 0, 0}
            || summary.median != 2.0 || summary.p90 != 4) {
            std::cerr << "Deterministic FIFO check failed.\n";
            return 1;
        }
        std::cout << "PASS deterministic FIFO waits and percentiles.\n";
        return 0;
    }
    if (argc != 1) {
        std::cerr << "Usage: queue-simulator [--self-test]\n";
        return 2;
    }

    const auto visits = synthetic_day();
    std::cout << "Synthetic planning scenario: " << visits.size()
              << " visits, same arrivals and durations for both room counts.\n";
    std::cout << std::fixed << std::setprecision(1);
    for (const int rooms : {2, 4}) {
        const auto summary = summarize(simulate(visits, rooms));
        std::cout << rooms << " rooms: median " << summary.median
                  << " min, p90 " << summary.p90 << " min\n";
    }
}
